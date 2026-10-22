import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import {
  Button,
  ButtonLink,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Img,
  Input,
  LoadingRegion,
  Select,
  Skeleton,
  TagInput,
  Textarea,
  toast,
} from '@/components/ui';
import { isApiErrorCode } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks';
import type { AdminMovie, MovieInput } from '@/types/api';
import { adminApi, adminKeys } from '../api';
import { AdminPageHeader, Panel, StatusPill } from '../components/AdminUi';
import { GENRE_SUGGESTIONS, LANGUAGE_SUGGESTIONS, MOVIE_STATUSES, titleCase } from '../catalogue/constants';
import { applyServerErrors } from '../catalogue/forms';

const urlOrEmpty = z
  .string()
  .trim()
  .refine((v) => v === '' || /^(https?:\/\/\S+|\/\S*)$/.test(v), 'Enter a full URL starting with https:// (or a site path starting with /)');

const schema = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(200, 'Keep the title under 200 characters'),
  slug: z
    .string()
    .trim()
    .regex(/^([a-z0-9]+(-[a-z0-9]+)*)?$/, 'Use lower-case letters, numbers and single hyphens, or leave blank to generate one'),
  tagline: z.string().trim().max(300, 'Keep the tagline under 300 characters'),
  synopsis: z.string().trim(),
  runtimeMinutes: z
    .string()
    .trim()
    .regex(/^\d+$/, 'Enter the runtime in whole minutes')
    .refine((v) => Number(v) >= 1 && Number(v) <= 600, 'The runtime must be between 1 and 600 minutes'),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a release date'),
  certification: z.string().trim().min(1, 'Enter a certification, for example U, PG or A'),
  languages: z.array(z.string()).min(1, 'Add at least one language'),
  genres: z.array(z.string()),
  director: z.string().trim(),
  cast: z.array(z.object({ name: z.string().trim().min(1, 'Enter the cast member’s name'), character: z.string().trim() })),
  trailerUrl: urlOrEmpty,
  posterUrl: urlOrEmpty,
  backdropUrl: urlOrEmpty,
  status: z.string().min(1, 'Choose a status'),
  isFeatured: z.boolean(),
});

type FormValues = z.infer<typeof schema>;
const FIELDS = Object.keys(schema.shape);

const emptyValues: FormValues = {
  title: '',
  slug: '',
  tagline: '',
  synopsis: '',
  runtimeMinutes: '',
  releaseDate: '',
  certification: '',
  languages: [],
  genres: [],
  director: '',
  cast: [],
  trailerUrl: '',
  posterUrl: '',
  backdropUrl: '',
  status: 'DRAFT',
  isFeatured: false,
};

function toValues(m: AdminMovie): FormValues {
  return {
    title: m.title,
    slug: m.slug ?? '',
    tagline: m.tagline ?? '',
    synopsis: m.synopsis ?? '',
    runtimeMinutes: m.runtimeMinutes ? String(m.runtimeMinutes) : '',
    releaseDate: m.releaseDate ?? '',
    certification: m.certification ?? '',
    languages: m.languages ?? [],
    genres: m.genres ?? [],
    director: m.director ?? '',
    cast: (m.cast ?? []).map((c) => ({ name: c.name, character: c.character ?? '' })),
    trailerUrl: m.trailerUrl ?? '',
    posterUrl: m.posterUrl ?? '',
    backdropUrl: m.backdropUrl ?? '',
    status: m.status,
    isFeatured: m.isFeatured,
  };
}

function toInput(v: FormValues): MovieInput {
  const input: MovieInput = {
    title: v.title,
    tagline: v.tagline,
    synopsis: v.synopsis,
    runtimeMinutes: Number(v.runtimeMinutes),
    releaseDate: v.releaseDate,
    certification: v.certification,
    languages: v.languages,
    genres: v.genres,
    director: v.director,
    cast: v.cast.map((c) => ({ name: c.name, character: c.character })),
    trailerUrl: v.trailerUrl,
    posterUrl: v.posterUrl,
    backdropUrl: v.backdropUrl,
    status: v.status,
    isFeatured: v.isFeatured,
  };
  if (v.slug !== '') input.slug = v.slug;
  return input;
}

function MovieForm({ movie }: { movie: AdminMovie | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: movie ? toValues(movie) : emptyValues });
  const cast = useFieldArray({ control, name: 'cast' });
  const posterUrl = useDebouncedValue(useWatch({ control, name: 'posterUrl' }), 400);
  const backdropUrl = useDebouncedValue(useWatch({ control, name: 'backdropUrl' }), 400);

  const save = useMutation({
    mutationFn: (input: MovieInput) => (movie ? adminApi.updateMovie(movie.id, input) : adminApi.createMovie(input)),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'movies'] });
      queryClient.invalidateQueries({ queryKey: adminKeys.lookups() });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      queryClient.setQueryData(adminKeys.movie(saved.id), saved);
      setFormError(null);
      if (movie) {
        toast.success('Movie saved.');
        reset(toValues(saved));
      } else {
        toast.success(`“${saved.title}” has been created.`);
        navigate(`/admin/movies/${saved.id}`, { replace: true });
      }
    },
    onError: (error) => {
      setFormError(
        isApiErrorCode(error, 'CONFLICT')
          ? `${applyServerErrors(error, setError, FIELDS)} The slug may already be used by another movie.`
          : applyServerErrors(error, setError, FIELDS),
      );
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    save.mutate(toInput(values));
  });

  const err = (name: keyof FormValues) => {
    const e = errors[name];
    return e && 'message' in e && typeof e.message === 'string' ? e.message : undefined;
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <FormError message={formError} />
        <Panel title="Details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Title" required error={err('title')} className="sm:col-span-2">
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('title')} />}
            </Field>
            <Field label="Slug" error={err('slug')} hint="Used in the web address. Leave blank to generate it from the title.">
              {({ id, describedBy, invalid }) => (
                <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder="e.g. the-last-reel" {...register('slug')} />
              )}
            </Field>
            <Field label="Tagline" error={err('tagline')}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('tagline')} />}
            </Field>
            <Field label="Synopsis" error={err('synopsis')} className="sm:col-span-2">
              {({ id, describedBy, invalid }) => <Textarea id={id} rows={5} aria-describedby={describedBy} aria-invalid={invalid} {...register('synopsis')} />}
            </Field>
            <Field label="Runtime (minutes)" required error={err('runtimeMinutes')}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} inputMode="numeric" aria-describedby={describedBy} aria-invalid={invalid} {...register('runtimeMinutes')} />
              )}
            </Field>
            <Field label="Release date" required error={err('releaseDate')}>
              {({ id, describedBy, invalid }) => <Input id={id} type="date" aria-describedby={describedBy} aria-invalid={invalid} {...register('releaseDate')} />}
            </Field>
            <Field label="Certification" required error={err('certification')} hint="For example U, PG, UA or A.">
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('certification')} />}
            </Field>
            <Field label="Director" error={err('director')}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('director')} />}
            </Field>
            <Field label="Languages" required error={err('languages')} hint="Press Enter or comma after each one.">
              {({ id, describedBy, invalid }) => (
                <Controller
                  control={control}
                  name="languages"
                  render={({ field }) => (
                    <TagInput id={id} describedBy={describedBy} invalid={invalid} value={field.value} onChange={field.onChange} suggestions={LANGUAGE_SUGGESTIONS} />
                  )}
                />
              )}
            </Field>
            <Field label="Genres" error={err('genres')} hint="Press Enter or comma after each one.">
              {({ id, describedBy, invalid }) => (
                <Controller
                  control={control}
                  name="genres"
                  render={({ field }) => (
                    <TagInput id={id} describedBy={describedBy} invalid={invalid} value={field.value} onChange={field.onChange} suggestions={GENRE_SUGGESTIONS} />
                  )}
                />
              )}
            </Field>
          </div>
        </Panel>

        <Panel
          title="Cast"
          actions={
            <Button variant="secondary" size="sm" onClick={() => cast.append({ name: '', character: '' })} leftIcon={<Plus className="size-3.5" aria-hidden />}>
              Add cast member
            </Button>
          }
        >
          {cast.fields.length === 0 ? (
            <p className="text-sm text-subtle">No cast listed. Add the principal cast in billing order.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {cast.fields.map((f, i) => (
                <li key={f.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2">
                  <span className="pt-2.5 text-xs tabular-nums text-subtle">{i + 1}</span>
                  <Field label={`Cast member ${i + 1} name`} labelHidden error={errors.cast?.[i]?.name?.message}>
                    {({ id, describedBy, invalid }) => (
                      <Input id={id} placeholder="Name" aria-describedby={describedBy} aria-invalid={invalid} {...register(`cast.${i}.name`)} />
                    )}
                  </Field>
                  <Field label={`Cast member ${i + 1} character`} labelHidden error={errors.cast?.[i]?.character?.message}>
                    {({ id, describedBy, invalid }) => (
                      <Input id={id} placeholder="Character (optional)" aria-describedby={describedBy} aria-invalid={invalid} {...register(`cast.${i}.character`)} />
                    )}
                  </Field>
                  <div className="flex gap-0.5 pt-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => cast.move(i, i - 1)} disabled={i === 0} aria-label={`Move cast member ${i + 1} up`}>
                      <ArrowUp className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => cast.move(i, i + 1)}
                      disabled={i === cast.fields.length - 1}
                      aria-label={`Move cast member ${i + 1} down`}
                    >
                      <ArrowDown className="size-3.5" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="hover:text-danger" onClick={() => cast.remove(i)} aria-label={`Remove cast member ${i + 1}`}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="Media">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Poster URL" error={err('posterUrl')} hint="Portrait, 2:3." className="sm:col-span-2">
              {({ id, describedBy, invalid }) => <Input id={id} type="url" aria-describedby={describedBy} aria-invalid={invalid} {...register('posterUrl')} />}
            </Field>
            <Field label="Backdrop URL" error={err('backdropUrl')} hint="Landscape, 16:9." className="sm:col-span-2">
              {({ id, describedBy, invalid }) => <Input id={id} type="url" aria-describedby={describedBy} aria-invalid={invalid} {...register('backdropUrl')} />}
            </Field>
            <Field label="Trailer URL" error={err('trailerUrl')} hint="A YouTube link plays in the site’s trailer player." className="sm:col-span-2">
              {({ id, describedBy, invalid }) => <Input id={id} type="url" aria-describedby={describedBy} aria-invalid={invalid} {...register('trailerUrl')} />}
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-[120px_minmax(0,1fr)] gap-3">
            <figure>
              <Img src={posterUrl} alt="Poster preview" className="rounded-md border border-line" />
              <figcaption className="mt-1 text-xs text-subtle">Poster</figcaption>
            </figure>
            <figure>
              <Img src={backdropUrl} alt="Backdrop preview" ratio="backdrop" className="rounded-md border border-line" />
              <figcaption className="mt-1 text-xs text-subtle">Backdrop</figcaption>
            </figure>
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4 xl:sticky xl:top-20 xl:self-start">
        <Panel title="Publishing">
          <div className="flex flex-col gap-4">
            <Field label="Status" error={err('status')} hint="Only published movies appear on the public site.">
              {({ id, describedBy, invalid }) => (
                <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('status')}>
                  {MOVIE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Checkbox label="Feature on the home page" {...register('isFeatured')} />
            <Button type="submit" loading={save.isPending} leftIcon={<Save className="size-4" aria-hidden />} className="w-full">
              {movie ? 'Save changes' : 'Create movie'}
            </Button>
            {movie && isDirty && <p className="text-center text-xs text-warning">You have unsaved changes.</p>}
          </div>
        </Panel>
        {movie && (
          <Panel title="Record">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-subtle">Status</dt>
              <dd>
                <StatusPill status={movie.status} />
              </dd>
              <dt className="text-subtle">Showtimes</dt>
              <dd className="tabular-nums text-fg">{movie.showtimeCount}</dd>
              {movie.tmdbId !== null && (
                <>
                  <dt className="text-subtle">TMDB ID</dt>
                  <dd className="tabular-nums text-fg">{movie.tmdbId}</dd>
                </>
              )}
              <dt className="text-subtle">Created</dt>
              <dd className="text-muted">{formatDateTime(movie.createdAt)}</dd>
              <dt className="text-subtle">Updated</dt>
              <dd className="text-muted">{formatDateTime(movie.updatedAt)}</dd>
            </dl>
          </Panel>
        )}
      </div>
    </form>
  );
}

function FormSkeleton() {
  return (
    <LoadingRegion label="Loading movie" className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-[460px] rounded-lg" />
        <Skeleton className="h-[140px] rounded-lg" />
        <Skeleton className="h-[320px] rounded-lg" />
      </div>
      <Skeleton className="h-[240px] rounded-lg" />
    </LoadingRegion>
  );
}

export default function MovieEditPage() {
  const params = useParams();
  const id = params.id !== undefined ? Number(params.id) : null;
  const isNew = id === null;
  const validId = id !== null && Number.isInteger(id) && id > 0;
  const movie = useQuery({ queryKey: adminKeys.movie(id ?? 0), queryFn: () => adminApi.movie(id ?? 0), enabled: validId });
  useDocumentTitle(isNew ? 'New movie' : movie.data ? `Edit ${movie.data.title}` : 'Edit movie');

  const back = (
    <Link to="/admin/movies" className="inline-flex items-center gap-1 hover:text-fg">
      <ArrowLeft className="size-3" aria-hidden /> Movies
    </Link>
  );

  if (!isNew && !validId) {
    return (
      <div>
        <AdminPageHeader eyebrow={back} title="Movie not found" />
        <EmptyState title="That is not a valid movie" description="Check the address, or go back to the movie list." action={<ButtonLink to="/admin/movies">All movies</ButtonLink>} />
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow={back}
        title={isNew ? 'New movie' : (movie.data?.title ?? 'Edit movie')}
        description={isNew ? 'New movies start as drafts until you publish them.' : 'Changes to a published movie appear on the site as soon as you save.'}
      />
      {isNew ? (
        <MovieForm key="new" movie={null} />
      ) : movie.isPending ? (
        <FormSkeleton />
      ) : movie.isError ? (
        <ErrorState
          error={movie.error}
          title={isApiErrorCode(movie.error, 'NOT_FOUND') ? 'This movie no longer exists' : 'We could not load this movie'}
          onRetry={isApiErrorCode(movie.error, 'NOT_FOUND') ? undefined : () => movie.refetch()}
          retrying={movie.isFetching}
        />
      ) : (
        <MovieForm key={movie.data.id} movie={movie.data} />
      )}
    </div>
  );
}
