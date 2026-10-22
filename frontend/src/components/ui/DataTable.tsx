import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { EmptyState, ErrorState, Skeleton } from './States';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  align?: 'left' | 'right' | 'center';
}

/** Dense, accessible table for admin lists, with matching skeleton rows, empty and error states. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  caption,
  onRowClick,
  skeletonRows = 6,
  className,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  caption: string;
  onRowClick?: (row: T) => void;
  skeletonRows?: number;
  className?: string;
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} compact />;
  const align = (a?: 'left' | 'right' | 'center') => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-line bg-surface', className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-elevated/50">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn('whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-subtle', align(c.align), c.headerClassName)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody aria-busy={isLoading || undefined}>
          {isLoading &&
            Array.from({ length: skeletonRows }, (_, i) => (
              <tr key={`sk-${i}`} className="border-b border-line/60 last:border-0">
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-3">
                    <Skeleton className="h-4 w-full max-w-[160px]" />
                  </td>
                ))}
              </tr>
            ))}
          {!isLoading &&
            rows?.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  'border-b border-line/60 transition-colors last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-elevated/60',
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-3 py-2.5 align-middle text-fg', align(c.align), c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
      {!isLoading && rows && rows.length === 0 && (
        <EmptyState title={emptyTitle} description={emptyDescription} className="m-4 border-0" />
      )}
    </div>
  );
}
