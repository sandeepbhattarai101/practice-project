import { Link } from 'react-router';
import { Armchair, Clock3, Crown, Sparkles } from 'lucide-react';
import { useCity } from '@/app/city';
import { useCurrentUser } from '@/features/auth/api';
import { useHome } from '../api';
import { ButtonLink, CertificationBadge, DevDataBadge, EmptyState, ErrorState, Img, Skeleton } from '@/components/ui';
import { useDocumentTitle } from '@/lib/hooks';
import { HeroFallback, HeroSkeleton } from '../components/HeroCarousel';
import { PosterCarousel } from '../components/PosterCarousel';
import { MovieCard, MovieCardSkeleton, movieMetaLine } from '../components/MovieCard';
import { Rail, SectionHeading } from '../components/Rail';
import { ShowtimeChip } from '../components/ShowtimeChip';
import { CinemaCard, CinemaCardSkeleton } from '../components/CinemaCard';
import { PromotionCard } from '../components/PromotionCard';
import type { HomeResponse } from '@/types/api';

/** Featured films first, then the rest of what's showing, without duplicates. */
function heroMovies(data: HomeResponse) {
  const seen = new Set<number>();
  return [...data.featured, ...data.nowShowing].filter((m) => !seen.has(m.id) && seen.add(m.id)).slice(0, 12);
}

function TodayShowtimes({ groups }: { groups: HomeResponse['todayShowtimes'] }) {
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No more shows today"
        description="Today's screenings have finished or sold out. Browse upcoming dates on any film."
        icon={<Clock3 className="size-5" />}
        action={<ButtonLink to="/movies" variant="secondary" size="sm">See all movies</ButtonLink>}
      />
    );
  }
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {groups.map(({ movie, showtimes }) => (
        <li key={movie.id} className="flex gap-4 rounded-lg border border-line bg-surface p-3 sm:p-4">
          <Link to={`/movies/${movie.slug}`} className="w-16 shrink-0 sm:w-20" tabIndex={-1} aria-hidden>
            <Img src={movie.posterUrl} alt="" className="rounded-sm" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-fg">
                <Link to={`/movies/${movie.slug}`} className="hover:text-accent">
                  {movie.title}
                </Link>
              </h3>
              <CertificationBadge value={movie.certification} />
              {movie.isSampleData && <DevDataBadge />}
            </div>
            <p className="mt-0.5 text-xs text-subtle">{movieMetaLine(movie, 3)}</p>
            <ul className="mt-3 flex flex-wrap gap-2" aria-label={`Today's times for ${movie.title}`}>
              {showtimes.map((s) => (
                <li key={s.id}>
                  <ShowtimeChip chip={s} compact />
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ul>
  );
}

function MembershipStrip() {
  const user = useCurrentUser();
  const perks = [
    { icon: Armchair, title: 'Pick your seats', text: 'Live seat maps, so you always know exactly where you will sit.' },
    { icon: Clock3, title: 'Faster checkout', text: 'Your details are filled in for you, every time.' },
    { icon: Crown, title: 'Member offers', text: 'Opt in to hear about screenings and exclusive codes first.' },
  ];
  return (
    <section aria-labelledby="membership-heading" className="relative overflow-hidden rounded-lg border border-line bg-surface">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_100%_0%,rgb(245_181_68/0.12),transparent_55%)]" aria-hidden />
      <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_2fr] lg:items-center">
        <div>
          <p className="eyebrow mb-2 flex items-center gap-1.5 text-accent">
            <Sparkles className="size-3.5" aria-hidden /> Membership
          </p>
          <h2 id="membership-heading" className="font-display text-3xl text-fg">
            {user ? `Welcome back, ${user.fullName.split(' ')[0]}` : 'Join Practice Project'}
          </h2>
          <p className="mt-2 text-sm text-muted">
            {user ? 'Your bookings and preferences live in your account.' : 'Free to join. Your tickets, all in one place.'}
          </p>
          <ButtonLink to={user ? '/account' : '/register'} className="mt-5">
            {user ? 'Go to my account' : 'Create a free account'}
          </ButtonLink>
        </div>
        <ul className="grid gap-4 sm:grid-cols-3">
          {perks.map((p) => (
            <li key={p.title} className="rounded-md border border-line bg-elevated/60 p-4">
              <p.icon className="size-5 text-accent" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold text-fg">{p.title}</h3>
              <p className="mt-1 text-sm text-muted">{p.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RailSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: 6 }, (_, i) => (
        <MovieCardSkeleton key={i} className="w-[42vw] shrink-0 sm:w-[200px] lg:w-[210px]" />
      ))}
    </div>
  );
}

export default function HomePage() {
  const { city } = useCity();
  const { data, error, isPending, refetch, isFetching } = useHome(city.slug);
  useDocumentTitle('Book cinema tickets');

  return (
    <main id="main">
      <div className="-mt-16">
        {isPending ? <HeroSkeleton /> : data && heroMovies(data).length > 0 ? <PosterCarousel movies={heroMovies(data)} /> : <HeroFallback />}
      </div>

      <div className="container-page relative z-10 mt-4 space-y-16 sm:space-y-20">
        {error ? (
          <ErrorState error={error} title="We could not load what's on" onRetry={() => refetch()} retrying={isFetching} />
        ) : (
          <>
            <section aria-labelledby="now-heading">
              <SectionHeading id="now-heading" eyebrow={`In ${city.name}`} title="Now showing" action={{ to: '/movies?when=now', label: 'See all' }} />
              {isPending ? (
                <RailSkeleton />
              ) : data.nowShowing.length ? (
                <Rail label="Now showing">{data.nowShowing.map((m) => <MovieCard key={m.id} movie={m} />)}</Rail>
              ) : (
                <EmptyState title={`Nothing showing in ${city.name} right now`} description="Check back soon, or switch city from the header." />
              )}
            </section>

            <section aria-labelledby="today-heading">
              <SectionHeading id="today-heading" eyebrow="Tonight and today" title="Today's showtimes" />
              {isPending ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="h-36" />
                  ))}
                </div>
              ) : (
                <TodayShowtimes groups={data.todayShowtimes} />
              )}
            </section>

            {(isPending || data.upcoming.length > 0) && (
              <section aria-labelledby="soon-heading">
                <SectionHeading id="soon-heading" eyebrow="On the horizon" title="Coming soon" action={{ to: '/movies?when=upcoming', label: 'See all' }} />
                {isPending ? <RailSkeleton /> : <Rail label="Coming soon">{data.upcoming.map((m) => <MovieCard key={m.id} movie={m} />)}</Rail>}
              </section>
            )}

            <section aria-labelledby="cinemas-heading">
              <SectionHeading id="cinemas-heading" eyebrow={city.name} title="Cinemas near you" action={{ to: '/cinemas', label: 'All cinemas' }} />
              {isPending ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 3 }, (_, i) => (
                    <CinemaCardSkeleton key={i} />
                  ))}
                </div>
              ) : data.cinemas.length ? (
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.cinemas.slice(0, 6).map((c) => (
                    <li key={c.id}>
                      <CinemaCard cinema={c} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title={`No cinemas in ${city.name} yet`} description="Try another city from the selector in the header." />
              )}
            </section>

            {!isPending && data.promotions.length > 0 && (
              <section aria-labelledby="offers-heading">
                <SectionHeading id="offers-heading" eyebrow="Save on your next visit" title="Offers" action={{ to: '/offers', label: 'All offers' }} />
                <ul className="grid gap-4 md:grid-cols-2">
                  {data.promotions.slice(0, 4).map((p) => (
                    <li key={p.id}>
                      <PromotionCard promotion={p} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <MembershipStrip />
      </div>
    </main>
  );
}
