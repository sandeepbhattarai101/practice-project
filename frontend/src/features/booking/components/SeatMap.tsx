import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Accessibility, Heart, X } from 'lucide-react';
import type { Seat, SeatCategory, SeatMap as SeatMapData } from '@/types/api';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/cn';

/** Seats the current viewer may pick: open seats, and seats already in their own hold. */
export function isSelectable(seat: Pick<Seat, 'state'>): boolean {
  return seat.state === 'AVAILABLE' || seat.state === 'MINE';
}

const stateText: Record<Seat['state'], string> = {
  AVAILABLE: 'available',
  MINE: 'available',
  HELD: 'held by another customer',
  SOLD: 'sold',
  UNAVAILABLE: 'unavailable',
};

export function seatAriaLabel(seat: Seat, category: SeatCategory | undefined, selected: boolean): string {
  const parts = [`Seat ${seat.label}`];
  if (category) parts.push(category.name, formatMoney(category.priceMinor));
  if (seat.type === 'WHEELCHAIR') parts.push('wheelchair space');
  if (seat.type === 'COMPANION') parts.push('companion seat');
  if (seat.type === 'COUPLE') parts.push('couple seat');
  parts.push(selected ? 'selected' : stateText[seat.state]);
  return parts.join(', ');
}

interface Props {
  map: Pick<SeatMapData, 'gridRows' | 'gridCols' | 'seats' | 'categories'>;
  selected: number[];
  onChange: (next: number[]) => void;
  maxSeats: number;
  onLimitReached?: (max: number) => void;
  disabled?: boolean;
  /** Seat cell size in px — the zoom control changes this. */
  seatSize?: number;
}

/**
 * The auditorium seat grid. Cells are 1-based `gridRow` × `gridCol`; empty cells are aisles.
 * Row labels appear on both sides. Seats are toggle buttons with roving focus (arrow keys move,
 * Space/Enter toggles, Home/End jump within a row).
 */
export function SeatMap({ map, selected, onChange, maxSeats, onLimitReached, disabled, seatSize = 30 }: Props) {
  const categories = useMemo(() => new Map(map.categories.map((c) => [c.id, c])), [map.categories]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const byCell = useMemo(() => {
    const m = new Map<string, Seat>();
    for (const s of map.seats) m.set(`${s.gridRow}:${s.gridCol}`, s);
    return m;
  }, [map.seats]);
  const rowLabels = useMemo(() => {
    const labels = new Map<number, string>();
    for (const s of map.seats) if (!labels.has(s.gridRow)) labels.set(s.gridRow, s.rowLabel);
    return labels;
  }, [map.seats]);
  const ordered = useMemo(
    () => [...map.seats].sort((a, b) => a.gridRow - b.gridRow || a.gridCol - b.gridCol),
    [map.seats],
  );

  const [focusId, setFocusId] = useState<number | null>(null);
  const refs = useRef(new Map<number, HTMLButtonElement>());
  const firstFocusable = ordered.find(isSelectable) ?? ordered[0];
  const rovingId = focusId !== null && map.seats.some((s) => s.id === focusId) ? focusId : firstFocusable?.id;

  const toggle = (seat: Seat) => {
    if (disabled || !isSelectable(seat)) return;
    if (selectedSet.has(seat.id)) {
      onChange(selected.filter((id) => id !== seat.id));
      return;
    }
    if (selected.length >= maxSeats) {
      onLimitReached?.(maxSeats);
      return;
    }
    onChange([...selected, seat.id]);
  };

  const move = (from: Seat, dRow: number, dCol: number): Seat | undefined => {
    if (dRow === 0) {
      const sameRow = ordered.filter((s) => s.gridRow === from.gridRow);
      return dCol > 0 ? sameRow.find((s) => s.gridCol > from.gridCol) : [...sameRow].reverse().find((s) => s.gridCol < from.gridCol);
    }
    const rows = [...new Set(ordered.map((s) => s.gridRow))];
    const idx = rows.indexOf(from.gridRow) + dRow;
    const targetRow = rows[idx];
    if (targetRow === undefined) return undefined;
    const candidates = ordered.filter((s) => s.gridRow === targetRow);
    return candidates.reduce<Seat | undefined>(
      (best, s) => (!best || Math.abs(s.gridCol - from.gridCol) < Math.abs(best.gridCol - from.gridCol) ? s : best),
      undefined,
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, seat: Seat) => {
    let target: Seat | undefined;
    switch (e.key) {
      case 'ArrowRight':
        target = move(seat, 0, 1);
        break;
      case 'ArrowLeft':
        target = move(seat, 0, -1);
        break;
      case 'ArrowDown':
        target = move(seat, 1, 0);
        break;
      case 'ArrowUp':
        target = move(seat, -1, 0);
        break;
      case 'Home':
        target = ordered.find((s) => s.gridRow === seat.gridRow);
        break;
      case 'End':
        target = [...ordered].reverse().find((s) => s.gridRow === seat.gridRow);
        break;
      default:
        return;
    }
    e.preventDefault();
    if (target) {
      setFocusId(target.id);
      refs.current.get(target.id)?.focus();
    }
  };

  const style = {
    '--seat': `${seatSize}px`,
    gridTemplateColumns: `1.75rem repeat(${map.gridCols}, var(--seat)) 1.75rem`,
    gridTemplateRows: `repeat(${map.gridRows}, var(--seat))`,
  } as CSSProperties;

  const cells: React.ReactNode[] = [];
  for (let r = 1; r <= map.gridRows; r++) {
    const label = rowLabels.get(r);
    cells.push(
      <div key={`l${r}`} className="grid place-items-center text-[11px] font-semibold text-subtle" style={{ gridRow: r, gridColumn: 1 }} aria-hidden>
        {label}
      </div>,
    );
    for (let c = 1; c <= map.gridCols; c++) {
      const seat = byCell.get(`${r}:${c}`);
      if (!seat) continue; // aisle / empty cell
      const category = categories.get(seat.categoryId);
      const isSelected = selectedSet.has(seat.id);
      const selectable = isSelectable(seat);
      const couple = seat.type === 'COUPLE';
      const spanTwo = couple && c < map.gridCols && !byCell.has(`${r}:${c + 1}`);
      const color = category?.color ?? 'var(--color-line-strong)';
      cells.push(
        <button
          key={seat.id}
          ref={(el) => {
            if (el) refs.current.set(seat.id, el);
            else refs.current.delete(seat.id);
          }}
          type="button"
          data-seat-id={seat.id}
          data-state={isSelected ? 'SELECTED' : seat.state}
          aria-pressed={selectable ? isSelected : undefined}
          aria-disabled={!selectable || disabled ? true : undefined}
          aria-label={seatAriaLabel(seat, category, isSelected)}
          tabIndex={seat.id === rovingId ? 0 : -1}
          onClick={() => {
            setFocusId(seat.id);
            toggle(seat);
          }}
          onKeyDown={(e) => onKeyDown(e, seat)}
          onFocus={() => setFocusId(seat.id)}
          title={`${seat.label}${category ? ` · ${category.name} · ${formatMoney(category.priceMinor)}` : ''}`}
          style={{
            gridRow: r,
            gridColumn: spanTwo ? `${c + 1} / span 2` : c + 1,
            ...(selectable && !isSelected ? { borderColor: color, color } : {}),
          }}
          className={cn(
            'relative m-[3px] grid place-items-center rounded-t-[7px] rounded-b-[3px] border-[1.5px] text-[10px] font-bold leading-none transition-[background-color,transform,border-color] duration-150 ease-out',
            selectable && !isSelected && 'bg-transparent hover:-translate-y-px hover:bg-white/5',
            isSelected && 'border-accent bg-accent text-accent-ink shadow-[0_0_0_3px_rgb(245_181_68/0.2)]',
            seat.state === 'HELD' && 'seat-held cursor-not-allowed border-line-strong bg-raised text-subtle',
            seat.state === 'SOLD' && 'cursor-not-allowed border-transparent bg-line-strong text-transparent',
            seat.state === 'UNAVAILABLE' && 'cursor-not-allowed border-dashed border-line bg-transparent text-subtle',
            disabled && selectable && 'cursor-not-allowed opacity-50',
          )}
        >
          {seat.state === 'UNAVAILABLE' ? (
            <X className="size-3" aria-hidden />
          ) : seat.type === 'WHEELCHAIR' ? (
            <Accessibility className="size-3.5" aria-hidden />
          ) : couple ? (
            <Heart className="size-3" aria-hidden />
          ) : seatSize >= 26 && seat.state !== 'SOLD' ? (
            <span aria-hidden>{seat.number}</span>
          ) : null}
        </button>,
      );
    }
    cells.push(
      <div key={`r${r}`} className="grid place-items-center text-[11px] font-semibold text-subtle" style={{ gridRow: r, gridColumn: map.gridCols + 2 }} aria-hidden>
        {label}
      </div>,
    );
  }

  return (
    <div role="group" aria-label="Seat map. Use the arrow keys to move between seats and Space to select." className="inline-grid" style={style}>
      {cells}
    </div>
  );
}

export function SeatLegend({ categories }: { categories: SeatCategory[] }) {
  const swatch = 'inline-block size-4 rounded-t-[5px] rounded-b-[2px] border-[1.5px]';
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Seat categories and prices">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-sm">
            <span className={swatch} style={{ borderColor: c.color }} aria-hidden />
            <span className="text-fg">{c.name}</span>
            <span className="text-subtle">{formatMoney(c.priceMinor)}</span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-subtle" aria-label="Seat states">
        <li className="flex items-center gap-2"><span className={cn(swatch, 'border-accent bg-accent')} aria-hidden /> Your selection</li>
        <li className="flex items-center gap-2"><span className={cn(swatch, 'seat-held border-line-strong bg-raised')} aria-hidden /> Held by others</li>
        <li className="flex items-center gap-2"><span className={cn(swatch, 'border-transparent bg-line-strong')} aria-hidden /> Sold</li>
        <li className="flex items-center gap-2"><Accessibility className="size-4" aria-hidden /> Wheelchair space</li>
        <li className="flex items-center gap-2"><Heart className="size-3.5" aria-hidden /> Couple seat</li>
      </ul>
    </div>
  );
}
