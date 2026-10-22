import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Save } from 'lucide-react';
import {
  Button,
  ButtonLink,
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
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks';
import type { AdminCinemaDetail, AdminCity, CinemaInput } from '@/types/api';
import { adminApi, adminKeys } from '../api';
import { AdminPageHeader, Panel } from '../components/AdminUi';
import { CINEMA_STATUSES, FACILITY_SUGGESTIONS, titleCase } from '../catalogue/constants';
import { applyServerErrors, optionalNumber } from '../catalogue/forms';

const coordinate = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .refine((v) => {
      const n = optionalNumber(v);
      return n === null || (Number.isFinite(n) && n >= min && n <= max);
    }, `Enter a ${label} between ${min} and ${max}, or leave blank`);

const schema = z
  .object({
    cityId: z.string().min(1, 'Choose a city'),
    name: z.string().trim().min(1, 'Enter the cinema name').max(150, 'Keep the name under 150 characters'),
    slug: z
      .string()
      .trim()
      .regex(/^([a-z0-9]+(-[a-z0-9]+)*)?$/, 'Use lower-case letters, numbers and single hyphens, or leave blank'),
    address: z.string().trim().min(1, 'Enter the address'),
    latitude: coordinate(-90, 90, 'latitude'),
    longitude: coordinate(-180, 180, 'longitude'),
    phone: z.string().trim().max(40, 'Keep the phone number under 40 characters'),
    description: z.string().trim(),
    facilities: z.array(z.string()),
    imageUrl: z
      .string()
      .trim()
      .refine((v) => v === '' || /^(https?:\/\/\S+|\/\S*)$/.test(v), 'Enter a full URL starting with https:// (or a site path starting with /)'),
    status: z.string().min(1, 'Choose a status'),
  })
  .refine((v) => (v.latitude.trim() === '') === (v.longitude.trim() === ''), {
    message: 'Enter both latitude and longitude, or neither',
    path: ['longitude'],
  });

type FormValues = z.infer<typeof schema>;
const FIELDS = ['cityId', 'name', 'slug', 'address', 'latitude', 'longitude', 'phone', 'description', 'facilities', 'imageUrl', 'status'];

function toValues(c: AdminCinemaDetail | null): FormValues {
  if (!c) {
    return { cityId: '', name: '', slug: '', address: '', latitude: '', longitude: '', phone: '', description: '', facilities: [], imageUrl: '', status: 'ACTIVE' };
  }
  return {
    cityId: String(c.cityId),
    name: c.name,
    slug: c.slug ?? '',
    address: c.address ?? '',
    latitude: c.latitude === null || c.latitude === undefined ? '' : String(c.latitude),
    longitude: c.longitude === null || c.longitude === undefined ? '' : String(c.longitude),
    phone: c.phone ?? '',
    description: c.description ?? '',
    facilities: c.facilities ?? [],
    imageUrl: c.imageUrl ?? '',
    status: c.status,
  };
}

function toInput(v: FormValues): CinemaInput {
  const input: CinemaInput = {
    cityId: Number(v.cityId),
    name: v.name,
    address: v.address,
    latitude: optionalNumber(v.latitude),
    longitude: optionalNumber(v.longitude),
    phone: v.phone,
    description: v.description,
    facilities: v.facilities,
    imageUrl: v.imageUrl,
    status: v.status,
  };
  if (v.slug !== '') input.slug = v.slug;
  return input;
}

function CinemaForm({ cinema, cities }: { cinema: AdminCinemaDetail | null; cities: AdminCity[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...toValues(cinema), cityId: cinema ? String(cinema.cityId) : String(cities.find((c) => c.isDefault)?.id ?? '') },
  });
  const imageUrl = useDebouncedValue(useWatch({ control, name: 'imageUrl' }), 400);

  const save = useMutation({
    mutationFn: (input: CinemaInput) => (cinema ? adminApi.updateCinema(cinema.id, input) : adminApi.createCinema(input)),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.cinemas() });
      queryClient.invalidateQueries({ queryKey: adminKeys.cinema(saved.id) });
      queryClient.invalidateQueries({ queryKey: adminKeys.lookups() });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      toast.success(cinema ? `${saved.name} has been saved.` : `${saved.name} has been created. Add its screens next.`);
      navigate(`/admin/cinemas/${saved.id}`);
    },
    onError: (error) => setFormError(applyServerErrors(error, setError, FIELDS)),
  });

  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    save.mutate(toInput(v));
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <FormError message={formError} />
        <Panel title="Venue">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" required error={errors.name?.message}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('name')} />}
            </Field>
            <Field label="City" required error={errors.cityId?.message}>
              {({ id, describedBy, invalid }) => (
                <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('cityId')}>
                  <option value="">Choose a city</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Slug" error={errors.slug?.message} hint="Used in the web address. Leave blank to generate it from the name.">
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('slug')} />}
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              {({ id, describedBy, invalid }) => <Input id={id} type="tel" autoComplete="off" aria-describedby={describedBy} aria-invalid={invalid} {...register('phone')} />}
            </Field>
            <Field label="Address" required error={errors.address?.message} className="sm:col-span-2">
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('address')} />}
            </Field>
            <Field label="Latitude" error={errors.latitude?.message} hint="Decimal degrees, e.g. 27.7172. Used for directions.">
              {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" aria-describedby={describedBy} aria-invalid={invalid} {...register('latitude')} />}
            </Field>
            <Field label="Longitude" error={errors.longitude?.message} hint="Decimal degrees, e.g. 85.3240.">
              {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" aria-describedby={describedBy} aria-invalid={invalid} {...register('longitude')} />}
            </Field>
            <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
              {({ id, describedBy, invalid }) => <Textarea id={id} rows={4} aria-describedby={describedBy} aria-invalid={invalid} {...register('description')} />}
            </Field>
            <Field label="Facilities" error={errors.facilities?.message} hint="Pick a suggestion or type your own, then press Enter." className="sm:col-span-2">
              {({ id, describedBy, invalid }) => (
                <Controller
                  control={control}
                  name="facilities"
                  render={({ field }) => (
                    <TagInput id={id} describedBy={describedBy} invalid={invalid} value={field.value} onChange={field.onChange} suggestions={FACILITY_SUGGESTIONS} />
                  )}
                />
              )}
            </Field>
          </div>
        </Panel>
        <Panel title="Photo">
          <Field label="Image URL" error={errors.imageUrl?.message} hint="A landscape photo of the venue, 16:9.">
            {({ id, describedBy, invalid }) => <Input id={id} type="url" aria-describedby={describedBy} aria-invalid={invalid} {...register('imageUrl')} />}
          </Field>
          <Img src={imageUrl} alt="Cinema photo preview" ratio="backdrop" className="mt-3 max-w-md rounded-md border border-line" />
        </Panel>
      </div>
      <div className="xl:sticky xl:top-20 xl:self-start">
        <Panel title="Status">
          <div className="flex flex-col gap-4">
            <Field label="Status" error={errors.status?.message} hint="Inactive cinemas are hidden from the public site.">
              {({ id, describedBy, invalid }) => (
                <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('status')}>
                  {CINEMA_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                  {cinema && !(CINEMA_STATUSES as readonly string[]).includes(cinema.status) && <option value={cinema.status}>{titleCase(cinema.status)}</option>}
                </Select>
              )}
            </Field>
            <Button type="submit" loading={save.isPending} leftIcon={<Save className="size-4" aria-hidden />} className="w-full">
              {cinema ? 'Save cinema' : 'Create cinema'}
            </Button>
          </div>
        </Panel>
      </div>
    </form>
  );
}

export default function CinemaEditPage() {
  const params = useParams();
  const id = params.id !== undefined ? Number(params.id) : null;
  const isNew = id === null;
  const validId = id !== null && Number.isInteger(id) && id > 0;
  const cinema = useQuery({ queryKey: adminKeys.cinema(id ?? 0), queryFn: () => adminApi.cinema(id ?? 0), enabled: validId });
  const cities = useQuery({ queryKey: adminKeys.cities(), queryFn: adminApi.cities });
  useDocumentTitle(isNew ? 'New cinema' : cinema.data ? `Edit ${cinema.data.name}` : 'Edit cinema');

  const back = isNew ? (
    <Link to="/admin/cinemas" className="inline-flex items-center gap-1 hover:text-fg">
      <ArrowLeft className="size-3" aria-hidden /> Cinemas
    </Link>
  ) : (
    <Link to={`/admin/cinemas/${id}`} className="inline-flex items-center gap-1 hover:text-fg">
      <ArrowLeft className="size-3" aria-hidden /> {cinema.data?.name ?? 'Cinema'}
    </Link>
  );

  if (!isNew && !validId) {
    return (
      <div>
        <AdminPageHeader eyebrow={back} title="Cinema not found" />
        <EmptyState title="That is not a valid cinema" action={<ButtonLink to="/admin/cinemas">All cinemas</ButtonLink>} />
      </div>
    );
  }

  const loading = cities.isPending || (!isNew && cinema.isPending);
  const error = cities.error ?? (!isNew ? cinema.error : null);

  return (
    <div>
      <AdminPageHeader eyebrow={back} title={isNew ? 'New cinema' : `Edit ${cinema.data?.name ?? 'cinema'}`} />
      {loading ? (
        <LoadingRegion label="Loading cinema" className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-[520px] rounded-lg" />
            <Skeleton className="h-[260px] rounded-lg" />
          </div>
          <Skeleton className="h-[180px] rounded-lg" />
        </LoadingRegion>
      ) : error ? (
        <ErrorState
          error={error}
          title={isApiErrorCode(error, 'NOT_FOUND') ? 'This cinema no longer exists' : 'We could not load the form'}
          onRetry={() => {
            if (cities.isError) cities.refetch();
            if (cinema.isError) cinema.refetch();
          }}
        />
      ) : cities.data && cities.data.length === 0 ? (
        <EmptyState title="Add a city first" description="Every cinema belongs to a city." action={<ButtonLink to="/admin/cities">Manage cities</ButtonLink>} />
      ) : (
        <CinemaForm key={cinema.data?.id ?? 'new'} cinema={isNew ? null : (cinema.data ?? null)} cities={cities.data ?? []} />
      )}
    </div>
  );
}
