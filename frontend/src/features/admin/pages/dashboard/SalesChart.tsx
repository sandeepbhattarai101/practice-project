import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Table2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { formatCalendarDate } from '@/lib/dates';
import { cn } from '@/lib/cn';

export interface SalesPoint {
  date: string;
  revenueMinor: number;
  tickets: number;
}

const HEIGHT = 220;
const PAD = { top: 16, right: 8, bottom: 26, left: 64 };

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(280, Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Rounds the axis maximum up to a tidy value (1, 2, 2.5, 5 × 10ⁿ). */
function niceMax(value: number): number {
  if (value <= 0) return 100;
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function compactMoney(minor: number): string {
  const rupees = minor / 100;
  if (rupees >= 100_000) return `${(rupees / 100_000).toLocaleString('en-GB', { maximumFractionDigits: 1 })}L`;
  if (rupees >= 1000) return `${(rupees / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })}k`;
  return rupees.toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

/**
 * Daily revenue as an accessible single-series bar chart: the SVG has role="img" with a summary,
 * each bar is focusable and shows a tooltip on hover or focus, and a data table can be toggled.
 */
export function SalesChart({ data }: { data: SalesPoint[] }) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const { max, total, totalTickets, best } = useMemo(() => {
    const peak = data.reduce((m, d) => Math.max(m, d.revenueMinor), 0);
    const bestDay = data.reduce<SalesPoint | null>((b, d) => (b === null || d.revenueMinor > b.revenueMinor ? d : b), null);
    return {
      max: niceMax(peak),
      total: data.reduce((s, d) => s + d.revenueMinor, 0),
      totalTickets: data.reduce((s, d) => s + d.tickets, 0),
      best: bestDay,
    };
  }, [data]);

  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const slot = data.length > 0 ? innerW / data.length : innerW;
  const barW = Math.max(2, Math.min(28, slot - 2));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64))));

  const summary =
    data.length === 0
      ? 'No sales in this period.'
      : `Revenue by day from ${formatCalendarDate(data[0].date)} to ${formatCalendarDate(data[data.length - 1].date)}: ` +
        `${formatMoney(total)} in total from ${totalTickets} tickets` +
        (best && best.revenueMinor > 0 ? `; the best day was ${formatCalendarDate(best.date)} with ${formatMoney(best.revenueMinor)}.` : '.');

  const activePoint = active !== null ? data[active] : null;
  const tipLeft = active !== null ? PAD.left + active * slot + slot / 2 : 0;

  return (
    <div>
      <div ref={wrapRef} className="relative" onMouseLeave={() => setActive(null)}>
        <svg width={width} height={HEIGHT} role="img" aria-label={summary} className="block max-w-full">
          {ticks.map((t) => (
            <g key={t} aria-hidden>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeDasharray={t === 0 ? undefined : '2 4'} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--color-subtle)" className="tabular-nums">
                {compactMoney(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2;
            const h = Math.max(d.revenueMinor > 0 ? 2 : 0, innerH - (y(d.revenueMinor) - PAD.top));
            const isActive = active === i;
            return (
              <g key={d.date} aria-hidden>
                <rect
                  className="bar transition-[fill] duration-150"
                  x={x}
                  y={PAD.top + innerH - h}
                  width={barW}
                  height={h}
                  rx={Math.min(4, barW / 2)}
                  fill={isActive ? 'var(--color-accent-strong)' : 'var(--color-accent)'}
                  fillOpacity={active === null || isActive ? 1 : 0.55}
                />
                {i % labelEvery === 0 && (
                  <text x={PAD.left + i * slot + slot / 2} y={HEIGHT - 8} textAnchor="middle" fontSize="11" fill="var(--color-subtle)" aria-hidden>
                    {formatCalendarDate(d.date).slice(0, 5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {/* Focusable hit targets (wider than the bars) sit over the plot; the SVG itself is one image. */}
        <div className="absolute flex" style={{ left: PAD.left, top: PAD.top, width: innerW, height: innerH }}>
          {data.map((d, i) => (
            <button
              key={d.date}
              type="button"
              className="h-full flex-1 rounded-xs outline-none focus-visible:outline-2 focus-visible:outline-accent"
              aria-label={`${formatCalendarDate(d.date)}: ${formatMoney(d.revenueMinor)}, ${d.tickets} ${d.tickets === 1 ? 'ticket' : 'tickets'}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => {
                setActive(i);
                setFocusIndex(i);
              }}
              tabIndex={i === (focusIndex ?? data.length - 1) ? 0 : -1}
              onBlur={() => setActive((a) => (a === i ? null : a))}
              onKeyDown={(e) => {
                const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? data.length - 1 : null;
                if (next === null || next < 0 || next >= data.length) return;
                e.preventDefault();
                setFocusIndex(next);
                const sibling = e.currentTarget.parentElement?.children[next];
                if (sibling instanceof HTMLElement) sibling.focus();
              }}
            />
          ))}
        </div>
        {activePoint && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-line-strong bg-elevated px-3 py-2 text-xs shadow-pop"
            style={{ left: Math.min(Math.max(tipLeft, 80), width - 80) }}
            aria-hidden
          >
            <p className="font-semibold text-fg">{formatCalendarDate(activePoint.date)}</p>
            <p className="mt-0.5 tabular-nums text-muted">{formatMoney(activePoint.revenueMinor)}</p>
            <p className="tabular-nums text-subtle">
              {activePoint.tickets} {activePoint.tickets === 1 ? 'ticket' : 'tickets'}
            </p>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-subtle">Bars show revenue per day. Hover, or tab in and use the arrow keys, for each day’s figures.</p>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((s) => !s)}
          leftIcon={<Table2 className="size-3.5" aria-hidden />}
        >
          {showTable ? 'Hide table' : 'Show as table'}
        </Button>
      </div>
      <div id={tableId} className={cn(!showTable && 'sr-only')}>
        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">Sales by day</caption>
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-subtle">
              <th scope="col" className="py-2 text-left font-semibold">Date</th>
              <th scope="col" className="py-2 text-right font-semibold">Tickets</th>
              <th scope="col" className="py-2 text-right font-semibold">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date} className="border-b border-line/60 last:border-0">
                <th scope="row" className="py-1.5 text-left font-normal text-muted">{formatCalendarDate(d.date)}</th>
                <td className="py-1.5 text-right tabular-nums">{d.tickets}</td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(d.revenueMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
