import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DataTable, Field, Input, Pagination, type Column } from '@/components/ui';
import { adminApi, adminKeys } from '@/features/admin/api';
import { AdminPageHeader, FilterBar } from '@/features/admin/components/AdminUi';
import { JsonDetails, Mono } from '@/features/admin/ops/shared';
import { useDebouncedFilter, useUrlFilters } from '@/features/admin/ops/useUrlFilters';
import { cn } from '@/lib/cn';
import { DEFAULT_TIMEZONE, formatDateTime } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import type { AuditEntry } from '@/types/api';

const PAGE_SIZE = 50;
const DEFAULTS = { entityType: '' };
/** Suggestions only: the contract does not enumerate entity types, so free text is accepted too. */
const ENTITY_SUGGESTIONS = ['Booking', 'Payment', 'Refund', 'Showtime', 'Movie', 'Cinema', 'Auditorium', 'City', 'Coupon', 'Promotion', 'User', 'Setting'];

export default function AuditPage() {
  useDocumentTitle('Audit log');
  const { values, setFilters, page, setPage } = useUrlFilters(DEFAULTS);
  const [entityType, setEntityType] = useDebouncedFilter(values.entityType, (v) => setFilters({ entityType: v.trim() }));

  const params = { entityType: values.entityType, page, size: PAGE_SIZE };
  const query = useQuery({ queryKey: adminKeys.audit(params), queryFn: () => adminApi.audit(params), placeholderData: keepPreviousData });

  const columns: Column<AuditEntry>[] = [
    {
      key: 'createdAt',
      header: 'When',
      cell: (e) => <span className="whitespace-nowrap text-xs tabular-nums text-muted">{formatDateTime(e.createdAt, DEFAULT_TIMEZONE)}</span>,
    },
    { key: 'actor', header: 'Actor', cell: (e) => <span className="text-fg">{e.actorEmail ?? <span className="text-subtle">System</span>}</span> },
    { key: 'action', header: 'Action', cell: (e) => <Mono className="font-semibold">{e.action}</Mono> },
    {
      key: 'entity',
      header: 'Entity',
      cell: (e) => (
        <span className="whitespace-nowrap">
          <span className="text-fg">{e.entityType}</span>
          {e.entityId !== null && e.entityId !== '' && <Mono className="ml-1.5 text-subtle">#{String(e.entityId)}</Mono>}
        </span>
      ),
    },
    { key: 'ip', header: 'IP address', cell: (e) => <Mono className="text-muted">{e.ipAddress ?? '—'}</Mono> },
    { key: 'details', header: 'Details', className: 'max-w-[420px]', cell: (e) => <JsonDetails value={e.details} summary="Show details" /> },
  ];

  const data = query.data;

  return (
    <>
      <AdminPageHeader title="Audit log" description={`Every administrative change, newest first. Times in ${DEFAULT_TIMEZONE}.`} />
      <FilterBar className="lg:grid-cols-[minmax(160px,280px)]">
        <Field label="Entity type">
          {({ id }) => (
            <>
              <Input id={id} list={`${id}-list`} value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="All entity types" autoComplete="off" />
              <datalist id={`${id}-list`}>
                {ENTITY_SUGGESTIONS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </>
          )}
        </Field>
      </FilterBar>
      <DataTable
        caption="Audit log"
        columns={columns}
        rows={data?.items}
        rowKey={(e) => e.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        emptyTitle="No audit entries"
        emptyDescription={values.entityType ? 'Nothing recorded for this entity type.' : undefined}
        className={cn(query.isPlaceholderData && 'opacity-70 transition-opacity duration-200')}
      />
      {data && <Pagination className="mt-4" page={data.page} totalPages={data.totalPages} totalItems={data.totalItems} onChange={setPage} />}
    </>
  );
}
