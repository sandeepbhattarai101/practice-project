import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Building2, Search } from 'lucide-react';
import { useCity } from '@/app/city';
import { useCinemas, useMovieFilters } from '../api';
import { Button, EmptyState, ErrorState, Input, Select } from '@/components/ui';
import { CinemaCard, CinemaCardSkeleton } from '../components/CinemaCard';
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks';

export default function CinemasPage() {
  const { city } = useCity();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const format = params.get('format') ?? '';
  const [search, setSearch] = useState(q);
  const debounced = useDebouncedValue(search.trim(), 300);
  useDocumentTitle(`Cinemas in ${city.name}`);

  const set = (key: string, value: string, replace = false) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace });
  };

  useEffect(() => {
    if (debounced !== q) set('q', debounced, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced value
  }, [debounced]);
  useEffect(() => setSearch(q), [q]);

  const filters = useMovieFilters(city.slug);
  const cinemas = useCinemas(city.slug, q, format);

  return (
    <main id="main" className="container-page pt-10">
      <header className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow mb-2">{city.name}</p>
          <h1 className="font-display text-4xl text-fg sm:text-5xl">Cinemas</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative w-full sm:w-64">
            <label htmlFor="cinema-search" className="sr-only">Search cinemas</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input id="cinema-search" type="search" placeholder="Search by name or area" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="w-44">
            <label htmlFor="cinema-format" className="sr-only">Format</label>
            <Select id="cinema-format" value={format} onChange={(e) => set('format', e.target.value)}>
              <option value="">All formats</option>
              {filters.data?.formats.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
          </div>
        </div>
      </header>

      {cinemas.error ? (
        <ErrorState error={cinemas.error} onRetry={() => cinemas.refetch()} retrying={cinemas.isFetching} />
      ) : cinemas.isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <CinemaCardSkeleton key={i} />)}
        </div>
      ) : cinemas.data.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-5" />}
          title={q || format ? 'No cinemas match' : `No cinemas in ${city.name} yet`}
          description={q || format ? 'Try a different search or format.' : 'Switch city from the header to see other locations.'}
          action={(q || format) && <Button variant="secondary" size="sm" onClick={() => { setSearch(''); setParams(new URLSearchParams()); }}>Clear search</Button>}
        />
      ) : (
        <ul className={`grid gap-5 transition-opacity sm:grid-cols-2 lg:grid-cols-3 ${cinemas.isPlaceholderData ? 'opacity-60' : ''}`}>
          {cinemas.data.map((c) => <li key={c.id}><CinemaCard cinema={c} /></li>)}
        </ul>
      )}
    </main>
  );
}
