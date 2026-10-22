import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Archive, DownloadCloud, Pencil, Plus, Send, Star, Trash2 } from 'lucide-react';
import {
  Button,
  ButtonLink,
  DataTable,
  Field,
  Img,
  Input,
  Pagination,
  Select,
  toast,
  useConfirm,
  type Column,
} from '@/components/ui';
import { useConfig } from '@/features/config/api';
import { ApiError, errorMessage } from '@/lib/api';
import { formatCalendarDate } from '@/lib/dates';
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks';
import type { AdminMovie } from '@/types/api';
import { adminApi, adminKeys, usePaged } from '../api';
import { AdminPageHeader, FilterBar, StatusPill } from '../components/AdminUi';
import { MOVIE_STATUSES, titleCase } from '../catalogue/constants';
import { TmdbImportDialog } from './movies/TmdbImportDialog';

const PAGE_SIZE = 20;

export default function MoviesPage() {
  useDocumentTitle('Movies');
  const config = useConfig();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [tmdbOpen, setTmdbOpen] = useState(false);
  const debouncedQ = useDebouncedValue(q.trim(), 300);

  const params = { q: debouncedQ, status, page, size: PAGE_SIZE };
  const movies = useQuery({
    queryKey: adminKeys.movies(params),
    queryFn: () => adminApi.movies(params),
    placeholderData: usePaged,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'movies'] });
    queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'movie'] });
    queryClient.invalidateQueries({ queryKey: adminKeys.lookups() });
    queryClient.invalidateQueries({ queryKey: ['catalog'] });
  };

  const setMovieStatus = useMutation({
    mutationFn: ({ movie, next }: { movie: AdminMovie; next: string }) => adminApi.setMovieStatus(movie.id, next),
    onSuccess: (_, { movie, next }) => {
      invalidate();
      toast.success(next === 'PUBLISHED' ? `“${movie.title}” is now published.` : `“${movie.title}” has been archived.`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMovie = useMutation({
    mutationFn: (movie: AdminMovie) => adminApi.deleteMovie(movie.id),
    onSuccess: (_, movie) => {
      invalidate();
      toast.success(`“${movie.title}” has been deleted.`);
    },
  });

  const onPublish = async (movie: AdminMovie) => {
    const ok = await confirm({
      title: `Publish “${movie.title}”?`,
      description: 'It will appear on the public site straight away.',
      confirmLabel: 'Publish',
    });
    if (ok) setMovieStatus.mutate({ movie, next: 'PUBLISHED' });
  };

  const onArchive = async (movie: AdminMovie) => {
    const ok = await confirm({
      title: `Archive “${movie.title}”?`,
      description: 'Archived movies are hidden from the public site. Existing bookings are not affected.',
      confirmLabel: 'Archive',
    });
    if (ok) setMovieStatus.mutate({ movie, next: 'ARCHIVED' });
  };

  const onDelete = async (movie: AdminMovie) => {
    const ok = await confirm({
      title: `Delete “${movie.title}”?`,
      description: 'This permanently removes the movie. It cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteMovie.mutateAsync(movie);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const archive = await confirm({
          title: 'This movie has showtimes',
          description: `“${movie.title}” cannot be deleted because showtimes (and possibly bookings) refer to it. Archive it instead to hide it from the public site while keeping its history.`,
          confirmLabel: 'Archive instead',
        });
        if (archive) setMovieStatus.mutate({ movie, next: 'ARCHIVED' });
      } else {
        toast.error(`The movie was not deleted: ${errorMessage(error)}`);
      }
    }
  };

  const busy = setMovieStatus.isPending || deleteMovie.isPending;

  const columns: Column<AdminMovie>[] = [
    {
      key: 'poster',
      header: <span className="sr-only">Poster</span>,
      className: 'w-14',
      cell: (m) => <Img src={m.posterUrl} alt="" className="w-9 rounded-xs" />,
    },
    {
      key: 'title',
      header: 'Title',
      cell: (m) => (
        <div className="min-w-0">
          <Link to={`/admin/movies/${m.id}`} className="font-semibold text-fg hover:text-accent">
            {m.title}
          </Link>
          <p className="text-xs text-subtle">
            {[m.certification, m.runtimeMinutes ? `${m.runtimeMinutes} min` : null, m.genres.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}
          </p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (m) => <StatusPill status={m.status} /> },
    {
      key: 'featured',
      header: 'Featured',
      align: 'center',
      cell: (m) =>
        m.isFeatured ? (
          <Star className="mx-auto size-4 fill-accent text-accent" aria-label="Featured" />
        ) : (
          <span className="text-subtle" aria-label="Not featured">
            —
          </span>
        ),
    },
    {
      key: 'release',
      header: 'Release',
      cell: (m) => <span className="tabular-nums text-muted">{m.releaseDate ? formatCalendarDate(m.releaseDate) : '—'}</span>,
    },
    { key: 'showtimes', header: 'Showtimes', align: 'right', cell: (m) => <span className="tabular-nums">{m.showtimeCount}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (m) => (
        <div className="flex justify-end gap-1">
          <ButtonLink to={`/admin/movies/${m.id}`} variant="ghost" size="icon-sm" aria-label={`Edit ${m.title}`} title="Edit">
            <Pencil className="size-3.5" aria-hidden />
          </ButtonLink>
          {m.status !== 'PUBLISHED' && (
            <Button variant="ghost" size="icon-sm" onClick={() => onPublish(m)} disabled={busy} aria-label={`Publish ${m.title}`} title="Publish">
              <Send className="size-3.5" aria-hidden />
            </Button>
          )}
          {m.status !== 'ARCHIVED' && (
            <Button variant="ghost" size="icon-sm" onClick={() => onArchive(m)} disabled={busy} aria-label={`Archive ${m.title}`} title="Archive">
              <Archive className="size-3.5" aria-hidden />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="hover:text-danger"
            onClick={() => onDelete(m)}
            disabled={busy}
            aria-label={`Delete ${m.title}`}
            title="Delete"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </div>
      ),
    },
  ];

  const filtered = debouncedQ !== '' || status !== '';

  return (
    <div>
      <AdminPageHeader
        eyebrow="Catalogue"
        title="Movies"
        description="Everything in the catalogue, including drafts and archived titles."
        actions={
          <>
            <Button variant="secondary" onClick={() => setTmdbOpen(true)} leftIcon={<DownloadCloud className="size-4" aria-hidden />}>
              Import from TMDB
            </Button>
            <ButtonLink to="/admin/movies/new">
              <Plus className="size-4" aria-hidden /> New movie
            </ButtonLink>
          </>
        }
      />
      {!config.tmdbEnabled && (
        <p className="mb-4 rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted" role="note">
          TMDB import is not configured on this server, so movies must be added by hand. Add a TMDB API key to the backend to enable it.
        </p>
      )}
      <FilterBar>
        <Field label="Search">
          {({ id }) => (
            <Input
              id={id}
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              placeholder="Title or slug"
            />
          )}
        </Field>
        <Field label="Status">
          {({ id }) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All statuses</option>
              {MOVIE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FilterBar>
      <DataTable
        caption="Movies"
        columns={columns}
        rows={movies.data?.items}
        rowKey={(m) => m.id}
        isLoading={movies.isPending}
        error={movies.isError ? movies.error : undefined}
        onRetry={() => movies.refetch()}
        emptyTitle={filtered ? 'No movies match' : 'No movies yet'}
        emptyDescription={filtered ? 'Try a different search or status.' : 'Create a movie or import one from TMDB to get started.'}
        className={movies.isPlaceholderData ? 'opacity-70 transition-opacity duration-200' : 'transition-opacity duration-200'}
      />
      {movies.data && (
        <Pagination className="mt-4" page={movies.data.page} totalPages={movies.data.totalPages} totalItems={movies.data.totalItems} onChange={setPage} />
      )}
      <TmdbImportDialog open={tmdbOpen} onClose={() => setTmdbOpen(false)} />
    </div>
  );
}
