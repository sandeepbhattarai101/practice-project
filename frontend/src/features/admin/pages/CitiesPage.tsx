import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus, Star } from 'lucide-react';
import { Badge, Button, Checkbox, DataTable, Dialog, Field, FormError, Input, toast, type Column } from '@/components/ui';
import { useDocumentTitle } from '@/lib/hooks';
import type { AdminCity } from '@/types/api';
import { adminApi, adminKeys } from '../api';
import { AdminPageHeader } from '../components/AdminUi';
import { TIMEZONE_SUGGESTIONS } from '../catalogue/constants';
import { applyServerErrors } from '../catalogue/forms';

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

const schema = z.object({
  name: z.string().trim().min(1, 'Enter the city name').max(100, 'Keep the name under 100 characters'),
  slug: z
    .string()
    .trim()
    .regex(/^([a-z0-9]+(-[a-z0-9]+)*)?$/, 'Use lower-case letters, numbers and single hyphens, or leave blank'),
  timezone: z.string().trim().min(1, 'Enter a time zone').refine(isValidTimeZone, 'Enter an IANA time zone such as Asia/Kathmandu'),
  isDefault: z.boolean(),
});
type FormValues = z.infer<typeof schema>;
const FIELDS = Object.keys(schema.shape);

function CityDialog({ city, open, onClose, hasDefault }: { city: AdminCity | null; open: boolean; onClose: () => void; hasDefault: boolean }) {
  const queryClient = useQueryClient();
  const listId = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: city
      ? { name: city.name, slug: city.slug, timezone: city.timezone, isDefault: city.isDefault }
      : { name: '', slug: '', timezone: 'Asia/Kathmandu', isDefault: !hasDefault },
  });

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = { name: v.name, timezone: v.timezone, isDefault: v.isDefault, ...(v.slug ? { slug: v.slug } : {}) };
      return city ? adminApi.updateCity(city.id, body) : adminApi.createCity(body);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.cities() });
      queryClient.invalidateQueries({ queryKey: adminKeys.lookups() });
      queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'cinemas'] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      toast.success(city ? `${saved.name} has been updated.` : `${saved.name} has been added.`);
      onClose();
    },
    onError: (error) => setFormError(applyServerErrors(error, setError, FIELDS)),
  });

  const formId = useId();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={city ? `Edit ${city.name}` : 'New city'}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {city ? 'Save city' : 'Add city'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((v) => {
          setFormError(null);
          save.mutate(v);
        })}
      >
        <FormError message={formError} />
        <Field label="Name" required error={errors.name?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('name')} />}
        </Field>
        <Field label="Slug" error={errors.slug?.message} hint="Used in web addresses. Leave blank to generate it from the name.">
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder="e.g. kathmandu" {...register('slug')} />}
        </Field>
        <Field label="Time zone" required error={errors.timezone?.message} hint="Showtimes in this city are displayed in this zone.">
          {({ id, describedBy, invalid }) => (
            <>
              <Input id={id} list={listId} autoComplete="off" aria-describedby={describedBy} aria-invalid={invalid} {...register('timezone')} />
              <datalist id={listId}>
                {TIMEZONE_SUGGESTIONS.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Checkbox label="Default city (pre-selected for new visitors)" {...register('isDefault')} />
      </form>
    </Dialog>
  );
}

export default function CitiesPage() {
  useDocumentTitle('Cities');
  const cities = useQuery({ queryKey: adminKeys.cities(), queryFn: adminApi.cities });
  const [editing, setEditing] = useState<{ city: AdminCity | null } | null>(null);
  const open = (city: AdminCity | null) => setEditing({ city });

  const columns: Column<AdminCity>[] = [
    {
      key: 'name',
      header: 'City',
      cell: (c) => (
        <span className="inline-flex items-center gap-2 font-semibold">
          {c.name}
          {c.isDefault && (
            <Badge tone="accent">
              <Star className="size-3" aria-hidden /> Default
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'slug', header: 'Slug', cell: (c) => <code className="text-xs text-muted">{c.slug}</code> },
    { key: 'tz', header: 'Time zone', cell: (c) => <span className="text-muted">{c.timezone}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (c) => (
        <Button variant="ghost" size="sm" onClick={() => open(c)} leftIcon={<Pencil className="size-3.5" aria-hidden />} aria-label={`Edit ${c.name}`}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        eyebrow="Catalogue"
        title="Cities"
        description="Cities group cinemas and set the time zone their showtimes are shown in."
        actions={
          <Button onClick={() => open(null)} leftIcon={<Plus className="size-4" aria-hidden />}>
            New city
          </Button>
        }
      />
      <DataTable
        caption="Cities"
        columns={columns}
        rows={cities.data}
        rowKey={(c) => c.id}
        isLoading={cities.isPending}
        error={cities.isError ? cities.error : undefined}
        onRetry={() => cities.refetch()}
        emptyTitle="No cities yet"
        emptyDescription="Add a city before creating cinemas in it."
        skeletonRows={4}
      />
      {editing && (
        <CityDialog
          key={editing.city?.id ?? 'new'}
          open
          city={editing.city}
          hasDefault={(cities.data ?? []).some((c) => c.isDefault)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
