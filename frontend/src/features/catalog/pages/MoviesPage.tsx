import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { useCity } from '@/app/city';
import { useMovies, type MovieListParams } from '../api';
import { Button, EmptyState, ErrorState, Input, Pagination, Select, Tabs } from '@/components/ui';
import { MovieCard, MovieCardSkeleton } from '../components/MovieCard';
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks';
import type { MovieSort, MovieWhen } from '@/types/api';

const PAGE_SIZE = 20;
const WHEN: { value: MovieWhen; label: string }[] = [
  { value: 'now', label: 'Now showing' },
  { value: 'upcoming', label: 'Coming soon' },
  { value: 'all', label: 'All' },
];
const SORTS: { value: MovieSort; label: string }[] = [
  { value: 'popular', label: 'Most popular' },
  { value: 'release', label: 'Release date' },
  { value: 'title', label: 'Title A–Z' },
];

function readWhen(v: string | null): MovieWhen {
  return v === 'upcoming' || v === 'all' ? v : 'now';
}
function readSort(v: string | null): MovieSort {
  return v === 'release' || v === 'title' ? v : 'popular';
}

export default function MoviesPage() {
  const { city } = useCity();
  const [params, setParams] = useSearchParams();
  const when = readWhen(params.get('when'));
  const sort = readSort(params.get('sort'));
  const q = params.get('q') ?? '';
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);

  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search, 300);
  useDocumentTitle(WHEN.find((w) => w.value === when)?.label ?? 'Movies');

  /** Updates search params; any filter change resets to page 0. Uses replace for typing. */
  const update = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace });
  };

  useEffect(() => {
    if (debouncedSearch.trim() !== q) update({ q: debouncedSearch.trim() || null }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced value
  }, [debouncedSearch]);

  useEffect(() => setSearch(q), [q]);

  const query: MovieListParams = { city: city.slug, when, sort, q: q || undefined, page, size: PAGE_SIZE };
  const movies = useMovies(query);

  return (
    <main id="main" className="container-page pt-10">
      <header className="mb-8">
        <p className="eyebrow mb-2">{city.name}</p>
        <h1 className="font-display text-4xl text-fg sm:text-5xl">Movies</h1>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <Tabs idBase="when" label="Showing" items={WHEN} value={when} onChange={(v) => update({ when: v === 'now' ? null : v })} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative w-full sm:w-64">
            <label htmlFor="movie-search" className="sr-only">Search movies</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input id="movie-search" type="search" placeholder="Search by title" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="w-44">
            <label htmlFor="movie-sort" className="sr-only">Sort by</label>
            <Select id="movie-sort" value={sort} onChange={(e) => update({ sort: e.target.value === 'popular' ? null : e.target.value })}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <section id="when-panel" role="tabpanel" aria-labelledby={`when-tab-${when}`} aria-busy={movies.isFetching || undefined}>
          {movies.error ? (
            <ErrorState error={movies.error} onRetry={() => movies.refetch()} retrying={movies.isFetching} />
          ) : movies.isPending ? (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 8 }, (_, i) => <li key={i}><MovieCardSkeleton /></li>)}
            </ul>
          ) : movies.data.items.length === 0 ? (
            <EmptyState
              title="No films match"
              description={q ? `Nothing found for “${q}”. Check the spelling or try another title.` : 'Nothing to show here yet. Check back soon.'}
              action={
                <Button variant="secondary" size="sm" onClick={() => { setSearch(''); setParams(new URLSearchParams(when === 'now' ? {} : { when })); }}>
                  Reset search
                </Button>
              }
            />
          ) : (
            <>
              <p className="mb-4 text-sm text-subtle" aria-live="polite">
                {movies.data.totalItems} {movies.data.totalItems === 1 ? 'film' : 'films'}
              </p>
              <ul className={`grid grid-cols-2 gap-x-4 gap-y-8 transition-opacity sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 ${movies.isPlaceholderData ? 'opacity-60' : ''}`}>
                {movies.data.items.map((m) => <li key={m.id}><MovieCard movie={m} /></li>)}
              </ul>
              <Pagination
                className="mt-10"
                page={movies.data.page}
                totalPages={movies.data.totalPages}
                onChange={(p) => {
                  update({ page: p === 0 ? null : String(p) });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
