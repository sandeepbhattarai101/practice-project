import { useEffect, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import { formatCountdown } from '@/lib/dates';
import { cn } from '@/lib/cn';

/**
 * Remaining milliseconds until `expiresAt`, ticking every second. Calls `onExpire` once
 * when it reaches zero (immediately if already in the past).
 */
export function useCountdown(expiresAt: string | null | undefined, onExpire?: () => void): number | null {
  const target = expiresAt ? new Date(expiresAt).getTime() : null;
  const [remaining, setRemaining] = useState<number | null>(() => (target === null ? null : Math.max(0, target - Date.now())));
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    if (target === null || Number.isNaN(target)) {
      setRemaining(null);
      return;
    }
    let fired = false;
    const tick = () => {
      const left = Math.max(0, target - Date.now());
      setRemaining(left);
      if (left === 0 && !fired) {
        fired = true;
        expireRef.current?.();
      }
      return left;
    };
    if (tick() === 0) return;
    const id = setInterval(() => {
      if (tick() === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [target]);

  return remaining;
}

/** Prominent hold timer. Announces at 2 minutes and 30 seconds left via aria-live. */
export function Countdown({
  expiresAt,
  onExpire,
  label = 'Seats held for',
  className,
  warnBelowMs = 2 * 60 * 1000,
}: {
  expiresAt: string;
  onExpire?: () => void;
  label?: string;
  className?: string;
  warnBelowMs?: number;
}) {
  const remaining = useCountdown(expiresAt, onExpire) ?? 0;
  const warning = remaining > 0 && remaining <= warnBelowMs;
  const announcement =
    remaining === 0
      ? 'Your hold has expired.'
      : remaining <= 30_000
        ? 'Less than 30 seconds left to complete your booking.'
        : remaining <= warnBelowMs
          ? 'Less than 2 minutes left to complete your booking.'
          : '';
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border px-3.5 py-2.5 transition-colors',
        warning ? 'border-warning/50 bg-warning/10' : 'border-line bg-elevated',
        remaining === 0 && 'border-danger/50 bg-danger/10',
        className,
      )}
    >
      <Timer className={cn('size-5 shrink-0', warning ? 'text-warning' : remaining === 0 ? 'text-danger' : 'text-accent')} aria-hidden />
      <div className="flex flex-col leading-tight">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</span>
        <span
          className={cn('font-display text-2xl tabular-nums', warning ? 'text-warning' : 'text-fg')}
          role="timer"
          aria-label={`${formatCountdown(remaining)} remaining`}
        >
          {formatCountdown(remaining)}
        </span>
      </div>
      <span className="sr-only" aria-live="assertive">
        {announcement}
      </span>
    </div>
  );
}
