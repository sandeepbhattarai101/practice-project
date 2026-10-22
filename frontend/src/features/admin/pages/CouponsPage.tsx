import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { Badge, Button, DataTable, Pagination, type Column } from '@/components/ui';
import { adminApi, adminKeys, useAdminLookups } from '@/features/admin/api';
import { AdminPageHeader } from '@/features/admin/components/AdminUi';
import { CouponFormDialog } from '@/features/admin/coupons/CouponFormDialog';
import { formatCouponDiscount } from '@/features/admin/coupons/couponForm';
import { useUrlFilters } from '@/features/admin/ops/useUrlFilters';
import { cn } from '@/lib/cn';
import { DEFAULT_TIMEZONE, formatDate } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { formatMoney } from '@/lib/money';
import type { AdminCoupon } from '@/types/api';

const PAGE_SIZE = 25;
const NO_FILTERS = {};

function validity(c: AdminCoupon): string {
  const from = c.validFrom ? formatDate(c.validFrom, DEFAULT_TIMEZONE) : null;
  const until = c.validUntil ? formatDate(c.validUntil, DEFAULT_TIMEZONE) : null;
  if (from && until) return `${from} – ${until}`;
  if (from) return `From ${from}`;
  if (until) return `Until ${until}`;
  return 'No time limit';
}

export default function CouponsPage() {
  useDocumentTitle('Coupons');
  const { page, setPage } = useUrlFilters(NO_FILTERS);
  const lookups = useAdminLookups();
  const [dialog, setDialog] = useState<{ coupon: AdminCoupon | null } | null>(null);

  const params = { page, size: PAGE_SIZE };
  const query = useQuery({ queryKey: adminKeys.coupons(params), queryFn: () => adminApi.coupons(params), placeholderData: keepPreviousData });

  const movieName = (id: number | null) => (id === null ? null : (lookups.data?.movies.find((m) => m.id === id)?.title ?? `Movie #${id}`));
  const cinemaName = (id: number | null) => (id === null ? null : (lookups.data?.cinemas.find((c) => c.id === id)?.name ?? `Cinema #${id}`));

  const columns: Column<AdminCoupon>[] = [
    { key: 'code', header: 'Code', cell: (c) => <span className="font-mono text-[13px] font-semibold tracking-wide text-fg">{c.code}</span> },
    {
      key: 'description',
      header: 'Description',
      cell: (c) => {
        const scope = [movieName(c.movieId), cinemaName(c.cinemaId)].filter(Boolean).join(' · ');
        return (
          <div className="max-w-[280px]">
            <div className="line-clamp-2 text-muted">{c.description || '—'}</div>
            {scope && <div className="mt-0.5 text-xs text-subtle">Only: {scope}</div>}
          </div>
        );
      },
    },
    {
      key: 'discount',
      header: 'Discount',
      cell: (c) => (
        <div className="whitespace-nowrap">
          <span className="font-semibold text-accent">{formatCouponDiscount(c.discountType, c.discountValue)}</span>
          {c.discountType === 'PERCENT' && c.maxDiscountMinor !== null && (
            <span className="text-xs text-subtle"> up to {formatMoney(c.maxDiscountMinor)}</span>
          )}
          {c.minSubtotalMinor !== null && <div className="text-xs text-subtle">Min. {formatMoney(c.minSubtotalMinor)}</div>}
        </div>
      ),
    },
    {
      key: 'usage',
      header: 'Used',
      cell: (c) => (
        <span className="tabular-nums">
          {c.usedCount}
          <span className="text-subtle"> / {c.usageLimit ?? '∞'}</span>
          {c.perUserLimit !== null && <span className="block text-xs text-subtle">{c.perUserLimit} per customer</span>}
        </span>
      ),
    },
    { key: 'validity', header: 'Valid', cell: (c) => <span className="whitespace-nowrap text-xs tabular-nums text-muted">{validity(c)}</span> },
    { key: 'active', header: 'Active', cell: (c) => (c.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="outline">Inactive</Badge>) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (c) => (
        <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ coupon: c })} aria-label={`Edit coupon ${c.code}`}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ),
    },
  ];

  const data = query.data;

  return (
    <>
      <AdminPageHeader
        title="Coupons"
        description="Discount codes customers can apply at checkout."
        actions={
          <Button onClick={() => setDialog({ coupon: null })} leftIcon={<Plus className="size-4" aria-hidden />}>
            New coupon
          </Button>
        }
      />
      <DataTable
        caption="Coupons"
        columns={columns}
        rows={data?.items}
        rowKey={(c) => c.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        emptyTitle="No coupons yet"
        emptyDescription="Create a coupon to run a promotion."
        className={cn(query.isPlaceholderData && 'opacity-70 transition-opacity duration-200')}
      />
      {data && <Pagination className="mt-4" page={data.page} totalPages={data.totalPages} totalItems={data.totalItems} onChange={setPage} />}
      <CouponFormDialog open={dialog !== null} coupon={dialog?.coupon ?? null} lookups={lookups.data} onClose={() => setDialog(null)} />
    </>
  );
}
