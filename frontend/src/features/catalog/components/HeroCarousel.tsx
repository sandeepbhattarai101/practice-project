import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, Pause, Play, Ticket } from 'lucide-react';
import type { MovieCard } from '@/types/api';
import { Button, ButtonLink, CertificationBadge, DevDataBadge, Img, Skeleton } from '@/components/ui';
import { formatCalendarDate, formatRuntime } from '@/lib/dates';
import { usePrefersReducedMotion } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import { TrailerDialog } from './TrailerDialog';

const INTERVAL = 7000;

/** True when the movie has no separate wide backdrop, only its portrait poster. */
function isPortraitOnly(m: MovieCard) {
  return !m.backdropUrl || m.backdropUrl === m.posterUrl;
}

export function HeroCarousel({ movies }: { movies: MovieCard[] }) {
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

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured films"
      className="relative isolate overflow-hidden"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
    >
      <div className="relative h-[78vh] max-h-[760px] min-h-[520px]">
        {movies.map((m, i) => (
          <div
            key={m.id}
            className={cn(
              'hero-grain absolute inset-0 transition-opacity duration-700 ease-out',
              i === index ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
            aria-hidden={i !== index}
          >
            {isPortraitOnly(m) ? (
              // Only portrait artwork exists (e.g. QFX posters): a blurred, zoomed copy fills the
              // wide banner and the crisp poster sits beside the title on large screens.
              <Img
                src={m.posterUrl}
                alt=""
                ratio="none"
                priority={i === 0}
                className="absolute inset-0 h-full w-full"
                imgClassName="scale-125 blur-2xl opacity-60 saturate-150"
              />
            ) : (
              <Img
                src={m.backdropUrl}
                alt=""
                ratio="none"
                priority={i === 0}
                className="absolute inset-0 h-full w-full"
                imgClassName={cn('scale-105 transition-transform duration-[8000ms] ease-out', i === index && !reducedMotion && 'scale-100')}
              />
            )}
            <div className="hero-vignette absolute inset-0" />
          </div>
        ))}

        <div className="container-page relative flex h-full flex-col justify-end pb-20 sm:pb-24">
          {isPortraitOnly(current) && (
            <div key={`poster-${current.id}`} className="absolute bottom-24 right-[max(1rem,calc((100vw-80rem)/2+1rem))] hidden w-60 animate-pop-in overflow-hidden rounded-lg shadow-2xl shadow-black/60 ring-1 ring-white/10 lg:block xl:w-72">
              <Img src={current.posterUrl} alt={`${current.title} poster`} ratio="poster" priority />
            </div>
          )}
          <div
            key={current.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${count}: ${current.title}`}
            className="max-w-2xl animate-pop-in"
          >
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="eyebrow text-accent">{current.showingStatus === 'UPCOMING' ? 'Coming soon' : 'Now showing'}</span>
              {current.isSampleData && <DevDataBadge />}
            </div>
            <h1 className="font-display text-4xl font-semibold leading-[1.02] text-fg sm:text-6xl lg:text-7xl">{current.title}</h1>
            {current.tagline && <p className="mt-4 max-w-xl text-base text-muted sm:text-lg">{current.tagline}</p>}
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <CertificationBadge value={current.certification} />
              <span>{formatRuntime(current.runtimeMinutes)}</span>
              <span aria-hidden className="text-subtle">·</span>
              <span>{current.genres.slice(0, 3).join(', ')}</span>
              {current.showingStatus === 'UPCOMING' && (
                <>
                  <span aria-hidden className="text-subtle">·</span>
                  <span>Releases {formatCalendarDate(current.releaseDate)}</span>
                </>
              )}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink to={`/movies/${current.slug}`} size="lg">
                <Ticket className="size-4" aria-hidden />
                {current.showingStatus === 'UPCOMING' ? 'View details' : 'Book tickets'}
              </ButtonLink>
              {current.trailerUrl && (
                <Button variant="secondary" size="lg" onClick={() => setTrailer(current)} className="bg-white/10 backdrop-blur-sm hover:bg-white/15">
                  <Play className="size-4 fill-current" aria-hidden />
                  Watch trailer
                </Button>
              )}
            </div>
          </div>
        </div>

        {count > 1 && (
          <div className="container-page absolute inset-x-0 bottom-6 flex items-center gap-3">
            <div className="flex items-center gap-1.5" role="group" aria-label="Choose slide">
              {movies.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Show ${m.title}`}
                  aria-current={i === index ? 'true' : undefined}
                  className="group grid h-6 place-items-center"
                >
                  <span className={cn('block h-[3px] rounded-full transition-all duration-300', i === index ? 'w-8 bg-accent' : 'w-4 bg-white/30 group-hover:bg-white/60')} />
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Resume slideshow' : 'Pause slideshow'}>
                {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => go(index - 1)} aria-label="Previous film">
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => go(index + 1)} aria-label="Next film">
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </div>

      <TrailerDialog open={trailer !== null} onClose={() => setTrailer(null)} title={trailer?.title ?? ''} url={trailer?.trailerUrl ?? null} />
    </section>
  );
}

export function HeroSkeleton() {
  return (
    <div className="relative h-[78vh] max-h-[760px] min-h-[520px] bg-surface" aria-hidden>
      <div className="container-page flex h-full flex-col justify-end gap-4 pb-24">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-16 w-full max-w-lg" />
        <Skeleton className="h-5 w-full max-w-md" />
        <div className="flex gap-3 pt-3">
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-12 w-40" />
        </div>
      </div>
    </div>
  );
}

export function HeroFallback() {
  return (
    <section className="hero-grain relative overflow-hidden border-b border-line bg-[radial-gradient(ellipse_at_top_left,rgb(245_181_68/0.12),transparent_55%)]">
      <div className="container-page py-24 sm:py-32">
        <p className="eyebrow text-accent">Practice Project</p>
        <h1 className="mt-3 max-w-2xl font-display text-5xl leading-tight text-fg sm:text-6xl">Your seat is waiting.</h1>
        <p className="mt-4 max-w-lg text-muted">Find a film, pick your seats and book in under a minute.</p>
        <div className="mt-7 flex gap-3">
          <ButtonLink to="/movies" size="lg">Browse movies</ButtonLink>
          <Link to="/cinemas" className="inline-flex h-12 items-center px-4 text-sm font-semibold text-muted hover:text-fg">
            Find a cinema
          </Link>
        </div>
      </div>
    </section>
  );
}
