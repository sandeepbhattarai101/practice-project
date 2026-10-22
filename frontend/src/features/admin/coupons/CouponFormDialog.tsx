import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Dialog, Field, FormError, Input, Select, Textarea, toast } from '@/components/ui';
import { adminApi, adminKeys } from '@/features/admin/api';
import { applyServerFieldErrors } from '@/features/admin/ops/shared';
import { errorMessage } from '@/lib/api';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import type { AdminCoupon, AdminLookups } from '@/types/api';
import { couponFieldMap, couponSchema, couponToFormValues, emptyCouponForm, toCouponInput, type CouponFormValues } from './couponForm';

const FIELD_NAMES = [
  'code',
  'description',
  'discountType',
  'discountValue',
  'maxDiscount',
  'minSubtotal',
  'validFrom',
  'validUntil',
  'usageLimit',
  'perUserLimit',
  'movieId',
  'cinemaId',
] as const;

export function CouponFormDialog({
  open,
  coupon,
  lookups,
  onClose,
}: {
  open: boolean;
  coupon: AdminCoupon | null;
  lookups: AdminLookups | undefined;
  onClose: () => void;
}) {
  if (!open) return null;
  return <CouponForm key={coupon?.id ?? 'new'} coupon={coupon} lookups={lookups} onClose={onClose} />;
}

function Suffixed({ children, prefix, suffix }: { children: React.ReactNode; prefix?: string; suffix?: string }) {
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-subtle">{prefix}</span>}
      {children}
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-subtle">{suffix}</span>}
    </div>
  );
}

function CouponForm({ coupon, lookups, onClose }: { coupon: AdminCoupon | null; lookups: AdminLookups | undefined; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setError, formState } = useForm<CouponFormValues>({
    resolver: zodResolver(couponSchema),
    defaultValues: coupon ? couponToFormValues(coupon, DEFAULT_TIMEZONE) : emptyCouponForm,
  });
  const { errors } = formState;
  const type = watch('discountType');

  const save = useMutation({
    mutationFn: (values: CouponFormValues) => {
      const body = toCouponInput(values, DEFAULT_TIMEZONE);
      return coupon ? adminApi.updateCoupon(coupon.id, body) : adminApi.createCoupon(body);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'coupons'] });
      toast.success(coupon ? `Coupon ${saved?.code ?? coupon.code} updated` : `Coupon ${saved?.code ?? ''} created`.trim());
      onClose();
    },
    onError: (error) => {
      applyServerFieldErrors(error, setError, FIELD_NAMES, couponFieldMap);
      setServerError(errorMessage(error));
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);
    save.mutate(values);
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title={coupon ? `Edit coupon ${coupon.code}` : 'New coupon'}
      description={`Validity times are in ${DEFAULT_TIMEZONE}.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="coupon-form" loading={save.isPending}>
            {coupon ? 'Save changes' : 'Create coupon'}
          </Button>
        </>
      }
    >
      <form id="coupon-form" noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <FormError message={serverError} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Code" required error={errors.code?.message} hint="Customers type this at checkout. Stored in capitals.">
            {({ id, describedBy, invalid }) => (
              <Input id={id} className="font-mono uppercase" autoComplete="off" spellCheck={false} aria-describedby={describedBy} aria-invalid={invalid} {...register('code')} />
            )}
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox label="Active — can be redeemed" {...register('isActive')} />
          </div>
        </div>
        <Field label="Description" error={errors.description?.message} hint="Shown to customers with the discount.">
          {({ id, describedBy, invalid }) => <Textarea id={id} rows={2} aria-describedby={describedBy} aria-invalid={invalid} {...register('description')} />}
        </Field>

        <fieldset className="grid grid-cols-1 gap-4 rounded-lg border border-line p-4 sm:grid-cols-3">
          <legend className="px-1 text-[13px] font-medium text-muted">Discount</legend>
          <Field label="Type" required error={errors.discountType?.message}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} {...register('discountType')}>
                <option value="PERCENT">Percentage</option>
                <option value="FIXED">Fixed amount</option>
              </Select>
            )}
          </Field>
          <Field
            label={type === 'PERCENT' ? 'Percentage' : 'Amount'}
            required
            error={errors.discountValue?.message}
            hint={type === 'PERCENT' ? 'e.g. 12.5 for 12.5%' : 'In rupees, e.g. 150'}
          >
            {({ id, describedBy, invalid }) => (
              <Suffixed prefix={type === 'FIXED' ? 'Rs.' : undefined} suffix={type === 'PERCENT' ? '%' : undefined}>
                <Input
                  id={id}
                  inputMode="decimal"
                  className={type === 'FIXED' ? 'pl-10 tabular-nums' : 'pr-8 tabular-nums'}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...register('discountValue')}
                />
              </Suffixed>
            )}
          </Field>
          {type === 'PERCENT' ? (
            <Field label="Maximum discount" error={errors.maxDiscount?.message} hint="Optional cap, in rupees.">
              {({ id, describedBy, invalid }) => (
                <Suffixed prefix="Rs.">
                  <Input id={id} inputMode="decimal" className="pl-10 tabular-nums" aria-describedby={describedBy} aria-invalid={invalid} {...register('maxDiscount')} />
                </Suffixed>
              )}
            </Field>
          ) : (
            <div aria-hidden />
          )}
          <Field label="Minimum order" error={errors.minSubtotal?.message} hint="Optional. Ticket subtotal, in rupees.">
            {({ id, describedBy, invalid }) => (
              <Suffixed prefix="Rs.">
                <Input id={id} inputMode="decimal" className="pl-10 tabular-nums" aria-describedby={describedBy} aria-invalid={invalid} {...register('minSubtotal')} />
              </Suffixed>
            )}
          </Field>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Valid from" error={errors.validFrom?.message} hint="Optional. Blank means immediately.">
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="datetime-local" aria-describedby={describedBy} aria-invalid={invalid} {...register('validFrom')} />
            )}
          </Field>
          <Field label="Valid until" error={errors.validUntil?.message} hint="Optional. Blank means no end date.">
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="datetime-local" aria-describedby={describedBy} aria-invalid={invalid} {...register('validUntil')} />
            )}
          </Field>
          <Field label="Total uses" error={errors.usageLimit?.message} hint="Optional. Blank means unlimited.">
            {({ id, describedBy, invalid }) => <Input id={id} inputMode="numeric" aria-describedby={describedBy} aria-invalid={invalid} {...register('usageLimit')} />}
          </Field>
          <Field label="Uses per customer" error={errors.perUserLimit?.message} hint="Optional. Blank means unlimited.">
            {({ id, describedBy, invalid }) => <Input id={id} inputMode="numeric" aria-describedby={describedBy} aria-invalid={invalid} {...register('perUserLimit')} />}
          </Field>
          <Field label="Only for movie" error={errors.movieId?.message}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('movieId')}>
                <option value="">Any movie</option>
                {lookups?.movies.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Only at cinema" error={errors.cinemaId?.message}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('cinemaId')}>
                <option value="">Any cinema</option>
                {lookups?.cinemas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
