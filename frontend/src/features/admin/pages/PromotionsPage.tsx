import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Img,
  Input,
  LoadingRegion,
  Skeleton,
  toast,
  useConfirm,
} from '@/components/ui';
import { adminApi, adminKeys } from '@/features/admin/api';
import { AdminPageHeader } from '@/features/admin/components/AdminUi';
import { applyServerFieldErrors } from '@/features/admin/ops/shared';
import { errorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import type { AdminPromotion, PromotionInput } from '@/types/api';

const urlOrPath = z
  .string()
  .trim()
  .max(500, 'Use no more than 500 characters')
  .refine((v) => v === '' || v.startsWith('/') || /^https?:\/\/\S+$/i.test(v), 'Enter a full URL (https://…) or a site path starting with /');

const promotionSchema = z
  .object({
    title: z.string().trim().min(2, 'Enter a title').max(120, 'Use no more than 120 characters'),
    subtitle: z.string().trim().max(240, 'Use no more than 240 characters'),
    imageUrl: urlOrPath,
    ctaLabel: z.string().trim().max(40, 'Use no more than 40 characters'),
    ctaUrl: urlOrPath,
    couponCode: z.string().trim().max(40, 'Use no more than 40 characters'),
  })
  .superRefine((v, ctx) => {
    if (v.ctaLabel && !v.ctaUrl) ctx.addIssue({ code: 'custom', path: ['ctaUrl'], message: 'A button needs a link' });
    if (v.ctaUrl && !v.ctaLabel) ctx.addIssue({ code: 'custom', path: ['ctaLabel'], message: 'Give the button a label' });
  });

type PromotionFormValues = z.infer<typeof promotionSchema>;
const FIELD_NAMES = ['title', 'subtitle', 'imageUrl', 'ctaLabel', 'ctaUrl', 'couponCode'] as const;

const blank = (v: string) => (v.trim() === '' ? null : v.trim());

function toValues(p: AdminPromotion | null): PromotionFormValues {
  return {
    title: p?.title ?? '',
    subtitle: p?.subtitle ?? '',
    imageUrl: p?.imageUrl ?? '',
    ctaLabel: p?.ctaLabel ?? '',
    ctaUrl: p?.ctaUrl ?? '',
    couponCode: p?.couponCode ?? '',
  };
}

function toInput(values: PromotionFormValues, original: AdminPromotion | null): PromotionInput {
  // Keep any extra fields the server returned (e.g. ordering or activity flags) so an edit does not clear them.
  const { id: _id, ...extra } = original ?? ({} as Partial<AdminPromotion>);
  return {
    ...extra,
    title: values.title.trim(),
    subtitle: blank(values.subtitle),
    imageUrl: blank(values.imageUrl),
    ctaLabel: blank(values.ctaLabel),
    ctaUrl: blank(values.ctaUrl),
    couponCode: values.couponCode.trim() === '' ? null : values.couponCode.trim().toUpperCase(),
  };
}

export default function PromotionsPage() {
  useDocumentTitle('Promotions');
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<{ promotion: AdminPromotion | null } | null>(null);
  const query = useQuery({ queryKey: adminKeys.promotions(), queryFn: adminApi.promotions });

  const remove = useMutation({
    mutationFn: (id: number) => adminApi.deletePromotion(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.promotions() });
      toast.success('Promotion deleted');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onDelete = async (p: AdminPromotion) => {
    const ok = await confirm({
      title: `Delete “${p.title}”?`,
      description: 'It will disappear from the home page straight away. This cannot be undone.',
      confirmLabel: 'Delete promotion',
      tone: 'danger',
    });
    if (ok) remove.mutate(p.id);
  };

  const header = (
    <AdminPageHeader
      title="Promotions"
      description="Banners shown on the home page."
      actions={
        <Button onClick={() => setDialog({ promotion: null })} leftIcon={<Plus className="size-4" aria-hidden />}>
          New promotion
        </Button>
      }
    />
  );

  let body: React.ReactNode;
  if (query.isPending) {
    body = (
      <LoadingRegion label="Loading promotions" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-line bg-surface">
            <Skeleton className="aspect-video rounded-none" />
            <div className="space-y-2 p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        ))}
      </LoadingRegion>
    );
  } else if (query.isError) {
    body = <ErrorState error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />;
  } else if (query.data.length === 0) {
    body = (
      <EmptyState
        icon={<Megaphone className="size-5" />}
        title="No promotions"
        description="Add a banner to feature an offer or a coupon on the home page."
        action={<Button onClick={() => setDialog({ promotion: null })}>New promotion</Button>}
      />
    );
  } else {
    body = (
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {query.data.map((p) => (
          <li key={p.id} className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-colors duration-200 hover:border-line-strong">
            <Img src={p.imageUrl} alt="" ratio="backdrop" />
            <div className="flex flex-1 flex-col gap-1.5 p-4">
              <h2 className="font-display text-lg leading-snug text-fg">{p.title}</h2>
              {p.subtitle && <p className="line-clamp-2 text-sm text-muted">{p.subtitle}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-xs">
                {p.couponCode && <Badge tone="accent">{p.couponCode}</Badge>}
                {p.ctaLabel && p.ctaUrl && (
                  <span className="inline-flex items-center gap-1 text-subtle" title={p.ctaUrl}>
                    <ExternalLink className="size-3" aria-hidden /> {p.ctaLabel}
                  </span>
                )}
                <span className="ml-auto flex gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ promotion: p })} aria-label={`Edit ${p.title}`}>
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="hover:text-danger"
                    onClick={() => onDelete(p)}
                    disabled={remove.isPending && remove.variables === p.id}
                    aria-label={`Delete ${p.title}`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      {header}
      {body}
      {dialog && <PromotionDialog key={dialog.promotion?.id ?? 'new'} promotion={dialog.promotion} onClose={() => setDialog(null)} />}
    </>
  );
}

function PromotionDialog({ promotion, onClose }: { promotion: AdminPromotion | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setError, formState } = useForm<PromotionFormValues>({
    resolver: zodResolver(promotionSchema),
    defaultValues: toValues(promotion),
  });
  const { errors } = formState;
  const imageUrl = watch('imageUrl');

  const save = useMutation({
    mutationFn: (values: PromotionFormValues) => {
      const body = toInput(values, promotion);
      return promotion ? adminApi.updatePromotion(promotion.id, body) : adminApi.createPromotion(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.promotions() });
      toast.success(promotion ? 'Promotion updated' : 'Promotion created');
      onClose();
    },
    onError: (error) => {
      applyServerFieldErrors(error, setError, FIELD_NAMES);
      setServerError(errorMessage(error));
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title={promotion ? 'Edit promotion' : 'New promotion'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="promotion-form" loading={save.isPending}>
            {promotion ? 'Save changes' : 'Create promotion'}
          </Button>
        </>
      }
    >
      <form
        id="promotion-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((v) => {
          setServerError(null);
          save.mutate(v);
        })}
      >
        <FormError message={serverError} />
        <Field label="Title" required error={errors.title?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('title')} />}
        </Field>
        <Field label="Subtitle" error={errors.subtitle?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('subtitle')} />}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
          <Field label="Image URL" error={errors.imageUrl?.message} hint="Wide image, at least 1280 × 720.">
            {({ id, describedBy, invalid }) => (
              <Input id={id} inputMode="url" aria-describedby={describedBy} aria-invalid={invalid} placeholder="https://…" {...register('imageUrl')} />
            )}
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-muted">Preview</p>
            <Img key={imageUrl} src={errors.imageUrl ? null : imageUrl.trim() || null} alt="Image preview" ratio="backdrop" className="rounded-md border border-line" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Button label" error={errors.ctaLabel?.message}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder="Book now" {...register('ctaLabel')} />}
          </Field>
          <Field label="Button link" error={errors.ctaUrl?.message} hint="A full URL or a site path such as /movies.">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('ctaUrl')} />}
          </Field>
        </div>
        <Field label="Coupon code" error={errors.couponCode?.message} hint="Optional. Shown on the banner so customers can copy it.">
          {({ id, describedBy, invalid }) => (
            <Input id={id} className="font-mono uppercase" autoComplete="off" aria-describedby={describedBy} aria-invalid={invalid} {...register('couponCode')} />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
