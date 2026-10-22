import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/cn';

/** Title row for every admin page. */
export function AdminPageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="font-display text-2xl text-fg sm:text-[1.75rem]">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Horizontal filter bar that wraps on small screens. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]', className)}>
      {children}
    </div>
  );
}

/** A bordered admin section card. */
export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const statusTones: Record<string, BadgeTone> = {
  // movies / cinemas / generic
  PUBLISHED: 'success',
  ACTIVE: 'success',
  DRAFT: 'neutral',
  ARCHIVED: 'outline',
  INACTIVE: 'outline',
  DISABLED: 'danger',
  SUSPENDED: 'danger',
  // showtimes
  SCHEDULED: 'info',
  OPEN: 'success',
  CANCELLED: 'danger',
  COMPLETED: 'outline',
  // bookings
  HELD: 'warning',
  PAYMENT_PENDING: 'info',
  CONFIRMED: 'success',
  EXPIRED: 'outline',
  // payments
  INITIATED: 'neutral',
  PENDING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  // refunds
  PROCESSED: 'success',
  REJECTED: 'danger',
};

export function humanise(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Coloured status pill for any upper-snake status string. */
export function StatusPill({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return null;
  return (
    <Badge tone={statusTones[status] ?? 'neutral'} className={className}>
      {humanise(status)}
    </Badge>
  );
}

/** Two-column definition list used in admin detail views. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{i.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-fg">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
