import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Zero-based pagination matching the API's `page` parameter. */
export function Pagination({
  page,
  totalPages,
  totalItems,
  onChange,
  className,
  label = 'Pagination',
}: {
  page: number;
  totalPages: number;
  totalItems?: number;
  onChange: (page: number) => void;
  className?: string;
  label?: string;
}) {
  if (totalPages <= 1) {
    return totalItems !== undefined ? (
      <p className={cn('text-xs text-subtle', className)}>
        {totalItems} {totalItems === 1 ? 'result' : 'results'}
      </p>
    ) : null;
  }
  const pages = pageWindow(page, totalPages);
  const btn =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-sm px-2 text-[13px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <nav aria-label={label} className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      {totalItems !== undefined && (
        <p className="text-xs text-subtle">
          Page {page + 1} of {totalPages} · {totalItems} results
        </p>
      )}
      <ul className="flex items-center gap-1">
        <li>
          <button type="button" className={cn(btn, 'text-muted hover:bg-elevated hover:text-fg')} disabled={page <= 0} onClick={() => onChange(page - 1)} aria-label="Previous page">
            <ChevronLeft className="size-4" aria-hidden />
          </button>
        </li>
        {pages.map((p, i) =>
          p === null ? (
            <li key={`gap-${i}`} className="px-1 text-subtle" aria-hidden>
              …
            </li>
          ) : (
            <li key={p}>
              <button
                type="button"
                className={cn(btn, p === page ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-elevated hover:text-fg')}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p + 1}`}
                onClick={() => onChange(p)}
              >
                {p + 1}
              </button>
            </li>
          ),
        )}
        <li>
          <button type="button" className={cn(btn, 'text-muted hover:bg-elevated hover:text-fg')} disabled={page >= totalPages - 1} onClick={() => onChange(page + 1)} aria-label="Next page">
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </li>
      </ul>
    </nav>
  );
}

function pageWindow(page: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const out: (number | null)[] = [0];
  const start = Math.max(1, page - 1);
  const end = Math.min(total - 2, page + 1);
  if (start > 1) out.push(null);
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 2) out.push(null);
  out.push(total - 1);
  return out;
}
