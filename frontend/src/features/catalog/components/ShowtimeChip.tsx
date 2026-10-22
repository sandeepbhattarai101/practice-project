import { Link } from 'react-router';
import type { ShowtimeChip as Chip } from '@/types/api';
import { formatTime } from '@/lib/dates';
import { formatMoneyRange } from '@/lib/money';
import { cn } from '@/lib/cn';

export function availabilityLabel(chip: Pick<Chip, 'availability' | 'salesOpen'>): string {
  if (chip.availability === 'SOLD_OUT') return 'Sold out';
  if (!chip.salesOpen) return 'Sales closed';
  if (chip.availability === 'FILLING_FAST') return 'Filling fast';
  return 'Available';
}

/** A bookable time. Disabled (not a link) when sold out or sales are closed. */
export function ShowtimeChip({ chip, showPrice = true, compact }: { chip: Chip; showPrice?: boolean; compact?: boolean }) {
  const time = formatTime(chip.startsAt, chip.timezone);
  const disabled = !chip.salesOpen || chip.availability === 'SOLD_OUT';
  const status = availabilityLabel(chip);
  const tone =
    chip.availability === 'SOLD_OUT' || !chip.salesOpen
      ? 'border-line text-subtle'
      : chip.availability === 'FILLING_FAST'
        ? 'border-warning/50 text-fg hover:border-warning hover:bg-warning/10'
        : 'border-line-strong text-fg hover:border-accent hover:bg-accent-soft';
  const label = `${time}, ${chip.format}, ${chip.language}, ${chip.auditoriumName}. ${status}.${
    showPrice ? ` ${formatMoneyRange(chip.minPriceMinor, chip.maxPriceMinor)}.` : ''
  }`;

  const body = (
    <>
      <span className="flex items-center gap-1.5">
        <span className={cn('font-semibold tabular-nums', compact ? 'text-sm' : 'text-[15px]')}>{time}</span>
        {chip.availability === 'FILLING_FAST' && chip.salesOpen && <span className="size-1.5 rounded-full bg-warning" aria-hidden />}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
        {chip.format}
        {!compact && ` · ${chip.language}`}
      </span>
      {!compact && (
        <span className={cn('text-[11px]', chip.availability === 'FILLING_FAST' && chip.salesOpen ? 'text-warning' : 'text-subtle')}>
          {disabled ? status : showPrice ? formatMoneyRange(chip.minPriceMinor, chip.maxPriceMinor) : status}
        </span>
      )}
    </>
  );

  const cls = cn(
    'inline-flex min-w-[88px] flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors duration-150',
    tone,
    disabled && 'cursor-not-allowed opacity-60 line-through decoration-subtle/60',
  );

  if (disabled) {
    return (
      <span className={cls} aria-disabled="true" role="link" aria-label={label} title={status}>
        {body}
      </span>
    );
  }
  return (
    <Link to={`/book/${chip.id}`} className={cls} aria-label={label} title={status}>
      {body}
    </Link>
  );
}

export function AvailabilityLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle" aria-label="Showtime availability key">
      <li className="flex items-center gap-1.5">
        <span className="size-2 rounded-full border border-line-strong" aria-hidden /> Available
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-warning" aria-hidden /> Filling fast
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-line-strong" aria-hidden /> Sold out / closed
      </li>
    </ul>
  );
}
