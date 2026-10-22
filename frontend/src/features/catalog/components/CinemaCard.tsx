import { Link } from 'react-router';
import {
  Accessibility,
  Armchair,
  Baby,
  Car,
  Coffee,
  CreditCard,
  Glasses,
  MapPin,
  Navigation,
  Popcorn,
  Snowflake,
  Sparkles,
  UtensilsCrossed,
  Volume2,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import type { CinemaCard as CinemaCardData } from '@/types/api';
import { Img, Skeleton } from '@/components/ui';

const facilityIcons: [RegExp, LucideIcon][] = [
  [/park/i, Car],
  [/wheel|access|disab/i, Accessibility],
  [/food|dining|restaurant|meal/i, UtensilsCrossed],
  [/popcorn|snack|concession/i, Popcorn],
  [/caf[eé]|coffee|bar|lounge/i, Coffee],
  [/recliner|seat|couch|sofa/i, Armchair],
  [/3d|glasses/i, Glasses],
  [/atmos|dolby|sound|audio/i, Volume2],
  [/wi-?fi|internet/i, Wifi],
  [/air|ac\b|climate/i, Snowflake],
  [/card|cashless|payment/i, CreditCard],
  [/baby|kid|family|child/i, Baby],
];

export function facilityIcon(name: string): LucideIcon {
  return facilityIcons.find(([re]) => re.test(name))?.[1] ?? Sparkles;
}

export function FacilityList({ facilities, max }: { facilities: string[]; max?: number }) {
  const shown = max ? facilities.slice(0, max) : facilities;
  const rest = max ? facilities.length - shown.length : 0;
  if (facilities.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Facilities">
      {shown.map((f) => {
        const Icon = facilityIcon(f);
        return (
          <li key={f} className="inline-flex items-center gap-1.5 rounded-xs border border-line bg-elevated px-2 py-1 text-xs text-muted">
            <Icon className="size-3.5 text-subtle" aria-hidden />
            {f}
          </li>
        );
      })}
      {rest > 0 && <li className="inline-flex items-center px-1 text-xs text-subtle">+{rest} more</li>}
    </ul>
  );
}

export function DirectionsLink({ cinema, className }: { cinema: Pick<CinemaCardData, 'directionsUrl' | 'name'>; className?: string }) {
  if (!cinema.directionsUrl) return null;
  return (
    <a
      href={cinema.directionsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? 'inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-accent'}
    >
      <Navigation className="size-3.5" aria-hidden />
      Directions
      <span className="sr-only"> to {cinema.name} (opens in a new tab)</span>
    </a>
  );
}

export function CinemaCard({ cinema }: { cinema: CinemaCardData }) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface transition-colors duration-200 hover:border-line-strong">
      <Img src={cinema.imageUrl} alt="" ratio="backdrop" imgClassName="transition-transform duration-300 group-hover:scale-[1.03]" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="font-display text-lg text-fg">
            <Link to={`/cinemas/${cinema.slug}`} className="after:absolute after:inset-0 hover:text-accent">
              {cinema.name}
            </Link>
          </h3>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-muted">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
            <span>{cinema.address}</span>
          </p>
        </div>
        {cinema.formats.length > 0 && (
          <p className="flex flex-wrap gap-1">
            {cinema.formats.map((f) => (
              <span key={f} className="rounded-xs bg-raised px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                {f}
              </span>
            ))}
          </p>
        )}
        <FacilityList facilities={cinema.facilities} max={4} />
        <div className="relative z-10 mt-auto flex items-center justify-between pt-1">
          <DirectionsLink cinema={cinema} />
          {cinema.phone && (
            <a href={`tel:${cinema.phone}`} className="text-sm text-subtle hover:text-fg">
              {cinema.phone}
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function CinemaCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface" aria-hidden>
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="space-y-2.5 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-6 w-1/2" />
      </div>
    </div>
  );
}
