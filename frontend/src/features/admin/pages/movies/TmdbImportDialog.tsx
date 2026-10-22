import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Download, Search } from 'lucide-react';
import { Button, Dialog, EmptyState, ErrorState, Field, FormError, Img, Input, Skeleton, toast } from '@/components/ui';
import { useConfig } from '@/features/config/api';
import { errorMessage, isApiErrorCode } from '@/lib/api';
import { formatCalendarDate } from '@/lib/dates';
import { adminApi, adminKeys } from '../../api';

const NOT_CONFIGURED =
  'TMDB import is not set up on this server. An administrator needs to add a TMDB API key to the backend configuration; until then, add movies by hand with “New movie”.';

function NotConfigured() {
  return (
    <div role="note" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-fg">
      {NOT_CONFIGURED}
    </div>
  );
}

export function TmdbImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const config = useConfig();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [importingId, setImportingId] = useState<number | null>(null);

  const search = useQuery({
    queryKey: adminKeys.tmdb(q),
    queryFn: () => adminApi.tmdbSearch(q),
    enabled: open && q.length >= 2,
    retry: false,
  });

  const importMovie = useMutation({
    mutationFn: (tmdbId: number) => adminApi.tmdbImport(tmdbId),
    onMutate: (tmdbId) => setImportingId(tmdbId),
    onSettled: () => setImportingId(null),
    onSuccess: (movie) => {
      queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'movies'] });
      queryClient.invalidateQueries({ queryKey: adminKeys.lookups() });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      toast.success(`Imported “${movie.title}”. Review the details before publishing.`);
      onClose();
      navigate(`/admin/movies/${movie.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(draft.trim());
  };

  const notConfigured = !config.tmdbEnabled || isApiErrorCode(search.error, 'TMDB_NOT_CONFIGURED') || isApiErrorCode(importMovie.error, 'TMDB_NOT_CONFIGURED');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import from TMDB"
      description="Search The Movie Database and import a title as a draft, with its poster, cast and synopsis."
      size="lg"
      dismissible={!importMovie.isPending}
    >
      {notConfigured && <NotConfigured />}
      <form onSubmit={submit} className="mt-3 flex items-end gap-2" role="search">
        <Field label="Title" className="flex-1">
          {({ id }) => <Input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Dune" autoComplete="off" />}
        </Field>
        <Button type="submit" disabled={draft.trim().length < 2} leftIcon={<Search className="size-4" aria-hidden />}>
          Search
        </Button>
      </form>
      {importMovie.isError && !isApiErrorCode(importMovie.error, 'TMDB_NOT_CONFIGURED') && (
        <div className="mt-3">
          <FormError message={`The import failed: ${errorMessage(importMovie.error)}`} />
        </div>
      )}
      <div className="mt-4" aria-live="polite">
        {q.length < 2 ? (
          <p className="text-sm text-subtle">Enter at least two characters and press Search.</p>
        ) : search.isPending ? (
          <ul className="flex flex-col gap-3" aria-busy="true" aria-label="Loading results">
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="flex gap-3">
                <Skeleton className="h-[96px] w-16 shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </li>
            ))}
          </ul>
        ) : search.isError ? (
          isApiErrorCode(search.error, 'TMDB_NOT_CONFIGURED') ? null : (
            <ErrorState error={search.error} title="The search failed" onRetry={() => search.refetch()} retrying={search.isFetching} compact />
          )
        ) : search.data.length === 0 ? (
          <EmptyState title="No matches" description={`TMDB has nothing for “${q}”. Try a different spelling or the original title.`} className="py-8" />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {search.data.map((r) => (
              <li key={r.tmdbId} className="flex gap-3 py-3 first:pt-0">
                <Img src={r.posterUrl} alt="" className="w-16 shrink-0 rounded-sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-fg">{r.title}</p>
                  <p className="text-xs text-subtle">{r.releaseDate ? formatCalendarDate(r.releaseDate) : 'Release date unknown'}</p>
                  {r.overview && <p className="mt-1 line-clamp-2 text-sm text-muted">{r.overview}</p>}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-center"
                  onClick={() => importMovie.mutate(r.tmdbId)}
                  loading={importingId === r.tmdbId}
                  disabled={importMovie.isPending && importingId !== r.tmdbId}
                  leftIcon={<Download className="size-3.5" aria-hidden />}
                  aria-label={`Import ${r.title}`}
                >
                  Import
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
