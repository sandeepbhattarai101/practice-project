import type { HTMLAttributes } from 'react';
import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-raised text-muted border-line',
  accent: 'bg-accent-soft text-accent border-accent/30',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
  info: 'bg-info/10 text-info border-info/30',
  outline: 'bg-transparent text-muted border-line-strong',
};

export function Badge({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-none tracking-wide',
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}

/** Shown on movies flagged `isSampleData`: their showtimes are development data, not real screenings. */
export function DevDataBadge({ className }: { className?: string }) {
  return (
    <Badge
      tone="info"
      className={cn('py-1 normal-case tracking-normal', className)}
      title="This movie and its showtimes are development data, not real screenings"
    >
      <FlaskConical className="size-3" aria-hidden />
      Development data
    </Badge>
  );
}

export function CertificationBadge({ value, className }: { value: string; className?: string }) {
  if (!value) return null;
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-strong px-1 text-[11px] font-bold text-muted',
        className,
      )}
      title={`Certificate ${value}`}
    >
      {value}
    </span>
  );
}
