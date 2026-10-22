import { cn } from '@/lib/cn';

/** The "Practice Project" wordmark with a small projector-frame mark. */
export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="7" fill="#0E0E13" stroke="var(--color-line-strong)" />
        <path d="M10 8h8.5a6 6 0 0 1 0 12H14v4h-4z" fill="var(--color-accent)" />
        <circle cx="18.3" cy="14" r="2.4" fill="#0E0E13" />
      </svg>
      {!compact && (
        <span className="font-display text-[1.15rem] font-semibold leading-none tracking-tight text-fg">
          Practice <span className="text-accent">Project</span>
        </span>
      )}
      {compact && <span className="sr-only">Practice Project</span>}
    </span>
  );
}
