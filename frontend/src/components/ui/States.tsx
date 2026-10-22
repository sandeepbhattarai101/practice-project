import type { ReactNode } from 'react';
import { AlertTriangle, Film, RotateCw } from 'lucide-react';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden />;
}

/** A loading region announced once to assistive tech. */
export function LoadingRegion({ label = 'Loading', children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-14 text-center', className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-elevated text-subtle" aria-hidden>
        {icon ?? <Film className="size-5" />}
      </div>
      <h3 className="font-display text-lg text-fg">{title}</h3>
      {description && <div className="mt-1.5 max-w-md text-sm text-muted">{description}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  title = 'We could not load this',
  onRetry,
  retrying,
  className,
  compact,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  compact?: boolean;
}) {
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-danger/25 bg-danger/5 text-center',
        compact ? 'px-4 py-6' : 'px-6 py-12',
        className,
      )}
    >
      <AlertTriangle className="mb-3 size-6 text-danger" aria-hidden />
      <h3 className="font-display text-lg text-fg">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{errorMessage(error)}</p>
      {requestId && <p className="mt-1 text-xs text-subtle">Reference: {requestId}</p>}
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={onRetry}
          loading={retrying}
          leftIcon={<RotateCw className="size-3.5" aria-hidden />}
        >
          Try again
        </Button>
      )}
    </div>
  );
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center', className)}>
      <span className="size-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageLoader() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Spinner />
    </div>
  );
}
