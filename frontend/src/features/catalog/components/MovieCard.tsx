import { Link } from 'react-router';
import type { MovieCard as MovieCardData } from '@/types/api';
import { Badge, CertificationBadge, Img, Skeleton } from '@/components/ui';
import { formatCalendarDate, formatRuntime } from '@/lib/dates';
import { cn } from '@/lib/cn';

/** "UA · 2h 15m · Action, Drama" */
export function movieMetaLine(movie: Pick<MovieCardData, 'runtimeMinutes' | 'genres'>, maxGenres = 2): string {
  return [formatRuntime(movie.runtimeMinutes), movie.genres.slice(0, maxGenres).join(', ')].filter(Boolean).join(' · ');
}

export function MovieCard({ movie, className, priority }: { movie: MovieCardData; className?: string; priority?: boolean }) {
  const upcoming = movie.showingStatus === 'UPCOMING';
  return (
    <Link
      to={`/movies/${movie.slug}`}
      className={cn('group block rounded-md outline-offset-4', className)}
      aria-label={`${movie.title}${upcoming ? `, releasing ${formatCalendarDate(movie.releaseDate)}` : ''}`}
    >
      <div className="relative overflow-hidden rounded-md shadow-card ring-1 ring-white/5 transition-[box-shadow,transform] duration-200 ease-out group-hover:-translate-y-1 group-hover:shadow-pop group-hover:ring-accent/40 group-focus-visible:ring-accent">
        <Img
          src={movie.posterUrl}
          alt=""
          ratio="poster"
          priority={priority}
          imgClassName="transition-transform duration-300 ease-out group-hover:scale-[1.04]"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" aria-hidden />
        <div className="absolute left-2 top-2 flex gap-1">
          {upcoming && <Badge tone="accent" className="bg-canvas/80 backdrop-blur-sm">Coming soon</Badge>}
        </div>
        {movie.formats.length > 0 && (
          <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
            {movie.formats.slice(0, 3).map((f) => (
              <span key={f} className="rounded-xs bg-canvas/80 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fg backdrop-blur-sm">
                {f}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 px-0.5">
        <h3 className="line-clamp-1 text-[15px] font-semibold text-fg transition-colors group-hover:text-accent">{movie.title}</h3>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-subtle">
          <CertificationBadge value={movie.certification} className="h-4 text-[10px]" />
          <span className="truncate">{upcoming ? `Releases ${formatCalendarDate(movie.releaseDate)}` : movieMetaLine(movie)}</span>
        </p>
      </div>
    </Link>
  );
}

export function MovieCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <Skeleton className="aspect-[2/3] w-full" />
      <Skeleton className="mt-3 h-4 w-3/4" />
      <Skeleton className="mt-1.5 h-3 w-1/2" />
    </div>
  );
}
