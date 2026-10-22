import { cn } from '@/lib/cn';

/** Occupancy-style bar. `secondary` (e.g. held seats) stacks after `value`. */
export function ProgressBar({
  value,
  max,
  secondary = 0,
  label,
  className,
  showText = true,
}: {
  value: number;
  max: number;
  secondary?: number;
  label: string;
  className?: string;
  showText?: boolean;
}) {
  const safeMax = Math.max(1, max);
  const pct = Math.min(100, (value / safeMax) * 100);
  const pct2 = Math.min(100 - pct, (secondary / safeMax) * 100);
  const tone = pct >= 90 ? 'bg-danger' : pct >= 65 ? 'bg-warning' : 'bg-accent';
  return (
    <div className={cn('flex min-w-[120px] items-center gap-2', className)}>
      <div
        className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-raised"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={value}
        aria-valuetext={`${value} of ${max}${secondary ? `, ${secondary} held` : ''}`}
      >
        <div className={cn('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: `${pct}%` }} />
        {pct2 > 0 && <div className="seat-held absolute inset-y-0 bg-muted/40" style={{ left: `${pct}%`, width: `${pct2}%` }} />}
      </div>
      {showText && (
        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted">
          {value}/{max}
        </span>
      )}
    </div>
  );
}
