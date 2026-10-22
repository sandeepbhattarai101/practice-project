import { useRef, type KeyboardEvent } from 'react';
import { calendarDateParts, formatCalendarDate, todayInZone, addDays } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui';

/** Horizontal date picker for dates that have bookable shows. A radiogroup with arrow-key navigation. */
export function DateStrip({
  dates,
  value,
  onChange,
  timezone,
  label = 'Choose a date',
}: {
  dates: string[];
  value: string | null;
  onChange: (date: string) => void;
  timezone: string;
  label?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const today = todayInZone(timezone);
  const tomorrow = addDays(today, 1);

  const onKey = (e: KeyboardEvent, i: number) => {
    let next = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(dates.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, i - 1);
    else return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(dates[next]);
  };

  return (
    <div role="radiogroup" aria-label={label} className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {dates.map((d, i) => {
        const p = calendarDateParts(d);
        const selected = d === value;
        const top = d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : p.weekday;
        return (
          <button
            key={d}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${top === p.weekday ? p.weekday : `${top}, ${p.weekday}`} ${formatCalendarDate(d)}`}
            tabIndex={selected || (!value && i === 0) ? 0 : -1}
            onClick={() => onChange(d)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'flex w-[68px] shrink-0 flex-col items-center rounded-md border py-2 transition-colors duration-150',
              selected ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
            )}
          >
            <span className={cn('text-[10px] font-bold uppercase tracking-wider', selected ? 'text-accent-ink/80' : 'text-subtle')}>{top}</span>
            <span className="font-display text-xl leading-tight">{p.day}</span>
            <span className={cn('text-[11px] font-semibold', selected ? 'text-accent-ink/80' : 'text-subtle')}>{p.month}</span>
          </button>
        );
      })}
    </div>
  );
}

export function DateStripSkeleton() {
  return (
    <div className="flex gap-2 overflow-hidden" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <Skeleton key={i} className="h-[74px] w-[68px] shrink-0" />
      ))}
    </div>
  );
}
