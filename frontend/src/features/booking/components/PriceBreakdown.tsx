import type { Booking } from '@/types/api';
import { formatBasisPoints, formatMoney } from '@/lib/money';

/** Itemised order from the server's authoritative `pricing`. */
export function PriceBreakdown({ booking }: { booking: Booking }) {
  const p = booking.pricing;
  const groups = new Map<string, { count: number; total: number; labels: string[] }>();
  for (const item of booking.items) {
    const g = groups.get(item.categoryName) ?? { count: 0, total: 0, labels: [] };
    g.count += 1;
    g.total += item.priceMinor;
    g.labels.push(item.seatLabel);
    groups.set(item.categoryName, g);
  }
  return (
    <dl className="space-y-2.5 text-sm">
      {[...groups.entries()].map(([name, g]) => (
        <div key={name} className="flex justify-between gap-3">
          <dt className="text-muted">
            {g.count} × {name}
            <span className="block text-xs text-subtle">Seats {g.labels.join(', ')}</span>
          </dt>
          <dd className="tabular-nums text-fg">{formatMoney(g.total)}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t border-line pt-2.5">
        <dt className="text-muted">Subtotal</dt>
        <dd className="tabular-nums text-fg">{formatMoney(p.subtotalMinor)}</dd>
      </div>
      {p.discountMinor > 0 && (
        <div className="flex justify-between gap-3">
          <dt className="text-success">Discount{booking.coupon ? ` (${booking.coupon.code})` : ''}</dt>
          <dd className="tabular-nums text-success">−{formatMoney(p.discountMinor)}</dd>
        </div>
      )}
      <div className="flex justify-between gap-3">
        <dt className="text-muted">Service fee</dt>
        <dd className="tabular-nums text-fg">{formatMoney(p.feeMinor)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted">
          {p.taxLabel} ({formatBasisPoints(p.taxRateBasisPoints)})
        </dt>
        <dd className="tabular-nums text-fg">{formatMoney(p.taxMinor)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <dt className="font-semibold text-fg">Total</dt>
        <dd className="font-display text-2xl tabular-nums text-fg">{formatMoney(p.totalMinor)}</dd>
      </div>
    </dl>
  );
}
