import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Checkbox, Dialog, Field, FormError, Input, TagInput, toast } from '@/components/ui';
import type { AdminAuditorium } from '@/types/api';
import { adminApi, adminKeys } from '../../api';
import { FORMAT_SUGGESTIONS } from '../../catalogue/constants';
import { applyServerErrors } from '../../catalogue/forms';
import { MAX_GRID_COLS, MAX_GRID_ROWS } from '../../layout/layoutUtils';

const gridSize = (max: number, label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `Enter the number of ${label}`)
    .refine((v) => Number(v) >= 1 && Number(v) <= max, `Between 1 and ${max} ${label}`);

const base = {
  name: z.string().trim().min(1, 'Enter a name, for example Screen 1').max(80, 'Keep the name under 80 characters'),
  formats: z.array(z.string()).min(1, 'Add at least one format'),
  isActive: z.boolean(),
};
/** The grid size is only sent (and so only validated) when creating; PUT does not accept it. */
const createSchema = z.object({ ...base, gridRows: gridSize(MAX_GRID_ROWS, 'rows'), gridCols: gridSize(MAX_GRID_COLS, 'columns') });
const editSchema = z.object({ ...base, gridRows: z.string(), gridCols: z.string() });
type FormValues = z.infer<typeof createSchema>;
const FIELDS = Object.keys(createSchema.shape);

/** Create (POST /cinemas/{id}/auditoriums) or edit (PUT /auditoriums/{id}) a screen. */
export function AuditoriumDialog({
  cinemaId,
  auditorium,
  onClose,
}: {
  cinemaId: number;
  auditorium: AdminAuditorium | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(auditorium ? editSchema : createSchema),
    defaultValues: {
      name: auditorium?.name ?? '',
      formats: auditorium?.formats ?? ['2D'],
      gridRows: String(auditorium?.gridRows ?? 10),
      gridCols: String(auditorium?.gridCols ?? 16),
      isActive: auditorium?.isActive ?? true,
    },
  });

  const save = useMutation({
    mutationFn: (v: FormValues) =>
      auditorium
        ? adminApi.updateAuditorium(auditorium.id, { name: v.name, formats: v.formats, isActive: v.isActive })
        : adminApi.createAuditorium(cinemaId, { name: v.name, formats: v.formats, gridRows: Number(v.gridRows), gridCols: Number(v.gridCols) }),
    onSuccess: (_, v) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.cinema(cinemaId) });
      queryClient.invalidateQueries({ queryKey: adminKeys.cinemas() });
      queryClient.invalidateQueries({ queryKey: adminKeys.lookups() });
      if (auditorium) queryClient.invalidateQueries({ queryKey: adminKeys.layout(auditorium.id) });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      toast.success(auditorium ? `${v.name} has been saved.` : `${v.name} has been added. Set up its seat layout next.`);
      onClose();
    },
    onError: (error) => setFormError(applyServerErrors(error, setError, FIELDS)),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={auditorium ? `Edit ${auditorium.name}` : 'Add screen'}
      description={auditorium ? 'To change the seats, use the seat layout editor.' : 'The grid sets the size of the seat layout; you can paint seats and aisles afterwards.'}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {auditorium ? 'Save screen' : 'Add screen'}
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
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder="Screen 1" {...register('name')} />}
        </Field>
        <Field label="Formats" required error={errors.formats?.message} hint="The formats this screen can show, e.g. 2D, 3D, IMAX.">
          {({ id, describedBy, invalid }) => (
            <Controller
              control={control}
              name="formats"
              render={({ field }) => (
                <TagInput id={id} describedBy={describedBy} invalid={invalid} value={field.value} onChange={field.onChange} suggestions={FORMAT_SUGGESTIONS} />
              )}
            />
          )}
        </Field>
        {auditorium ? (
          <Checkbox label="Active (inactive screens cannot be scheduled)" {...register('isActive')} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Grid rows" required error={errors.gridRows?.message}>
              {({ id, describedBy, invalid }) => <Input id={id} inputMode="numeric" aria-describedby={describedBy} aria-invalid={invalid} {...register('gridRows')} />}
            </Field>
            <Field label="Grid columns" required error={errors.gridCols?.message}>
              {({ id, describedBy, invalid }) => <Input id={id} inputMode="numeric" aria-describedby={describedBy} aria-invalid={invalid} {...register('gridCols')} />}
            </Field>
          </div>
        )}
      </form>
    </Dialog>
  );
}
