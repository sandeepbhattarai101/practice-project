import { Link } from 'react-router';
import { CalendarDays, Clock, MapPin, MonitorPlay } from 'lucide-react';
import { CertificationBadge, DevDataBadge, Img } from '@/components/ui';
import { formatTime, formatWeekdayDate } from '@/lib/dates';
import { cn } from '@/lib/cn';

export interface ShowSummaryData {
  movie: { slug: string; title: string; posterUrl: string; certification: string };
  cinemaName: string;
  cinemaSlug?: string;
  auditoriumName: string;
  startsAt: string;
  timezone: string;
  format: string;
  language: string;
  isSampleData?: boolean;
}

/** Compact "what you are booking" header used on seat selection, checkout and booking pages. */
export function ShowSummary({ show, className, size = 'md' }: { show: ShowSummaryData; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('flex items-start gap-4', className)}>
      <Link to={`/movies/${show.movie.slug}`} tabIndex={-1} aria-hidden className={size === 'sm' ? 'w-12 shrink-0' : 'w-16 shrink-0 sm:w-20'}>
        <Img src={show.movie.posterUrl} alt="" className="rounded-sm ring-1 ring-white/10" />
      </Link>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={cn('font-display leading-tight text-fg', size === 'sm' ? 'text-lg' : 'text-2xl sm:text-3xl')}>
            <Link to={`/movies/${show.movie.slug}`} className="hover:text-accent">
              {show.movie.title}
            </Link>
          </h1>
          <CertificationBadge value={show.movie.certification} />
          {show.isSampleData && <DevDataBadge />}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <li className="flex items-center gap-1.5">
            <MapPin className="size-3.5 text-subtle" aria-hidden />
            {show.cinemaSlug ? (
              <Link to={`/cinemas/${show.cinemaSlug}`} className="hover:text-fg">
                {show.cinemaName}
              </Link>
            ) : (
              show.cinemaName
            )}
            <span className="text-subtle">· {show.auditoriumName}</span>
          </li>
          <li className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5 text-subtle" aria-hidden />
            {formatWeekdayDate(show.startsAt, show.timezone)}
          </li>
          <li className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-subtle" aria-hidden />
            {formatTime(show.startsAt, show.timezone)}
          </li>
          <li className="flex items-center gap-1.5">
            <MonitorPlay className="size-3.5 text-subtle" aria-hidden />
            {show.format} · {show.language}
          </li>
        </ul>
      </div>
    </div>
  );
}
