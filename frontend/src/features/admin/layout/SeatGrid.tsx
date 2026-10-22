import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Accessibility, Ban, Heart, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { LayoutCategory } from '@/types/api';
import { cellKey, readableInk, type Cells, type EditorSeat } from './layoutUtils';

const TYPE_LABEL: Record<EditorSeat['seatType'], string> = {
  STANDARD: '',
  WHEELCHAIR: 'wheelchair space',
  COMPANION: 'companion seat',
  COUPLE: 'couple seat',
};

function describeCell(row: number, col: number, seat: EditorSeat | undefined, categoryName: string | undefined): string {
  const where = `grid row ${row}, column ${col}`;
  if (!seat) return `Aisle, ${where}`;
  const label = seat.rowLabel && seat.seatNumber > 0 ? `Seat ${seat.rowLabel}${seat.seatNumber}` : 'New seat, not yet numbered';
  const parts = [label, categoryName ?? `unknown category ${seat.categoryCode}`];
  if (TYPE_LABEL[seat.seatType]) parts.push(TYPE_LABEL[seat.seatType]);
  if (!seat.isActive) parts.push('disabled');
  parts.push(where);
  return parts.join(', ');
}

interface CellProps {
  row: number;
  col: number;
  seat: EditorSeat | undefined;
  category: LayoutCategory | undefined;
  tabbable: boolean;
  readOnly: boolean;
  register: (key: string, el: HTMLButtonElement | null) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, row: number, col: number) => void;
  onPointerDown: (e: PointerEvent<HTMLButtonElement>, row: number, col: number) => void;
  onActivate: (row: number, col: number) => void;
  onFocusCell: (row: number, col: number) => void;
}

const Cell = memo(function Cell({ row, col, seat, category, tabbable, readOnly, register, onKeyDown, onPointerDown, onActivate, onFocusCell }: CellProps) {
  const key = cellKey(row, col);
  const colour = category?.color ?? '#f06565';
  const Icon = seat?.seatType === 'WHEELCHAIR' ? Accessibility : seat?.seatType === 'COUPLE' ? Heart : seat?.seatType === 'COMPANION' ? Users : null;
  return (
    <div role="gridcell" className="size-7">
      <button
        ref={(el) => register(key, el)}
        type="button"
        data-row={row}
        data-col={col}
        tabIndex={tabbable ? 0 : -1}
        aria-label={describeCell(row, col, seat, category?.name)}
        aria-disabled={readOnly || undefined}
        onKeyDown={(e) => onKeyDown(e, row, col)}
        onPointerDown={(e) => onPointerDown(e, row, col)}
        onFocus={() => onFocusCell(row, col)}
        onClick={(e) => {
          // detail === 0: activated by keyboard (Enter/Space) or assistive tech, not by the pointer stroke.
          if (e.detail === 0) onActivate(row, col);
        }}
        className={cn(
          'relative grid size-7 place-items-center rounded-[5px] text-[9px] font-bold leading-none transition-[background-color,box-shadow,opacity] duration-150',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fg',
          seat ? 'shadow-[inset_0_-2px_0_rgb(0_0_0/0.25)]' : 'border border-dashed border-line/70 hover:border-line-strong',
          seat && !seat.isActive && 'seat-held opacity-60',
          readOnly ? 'cursor-default' : 'cursor-crosshair',
        )}
        style={seat ? { backgroundColor: colour, color: readableInk(colour) } : undefined}
      >
        {seat && !seat.isActive ? (
          <Ban className="size-3.5" aria-hidden />
        ) : Icon ? (
          <Icon className="size-3.5" aria-hidden />
        ) : seat && seat.seatNumber > 0 ? (
          <span aria-hidden className="tabular-nums">
            {seat.seatNumber}
          </span>
        ) : null}
      </button>
    </div>
  );
});

/**
 * The paintable seat grid. Cells are buttons in a roving-tabindex grid: arrow keys move,
 * Home/End jump within a row, Enter/Space paints. Pointer down + drag paints a stroke.
 */
export function SeatGrid({
  gridRows,
  gridCols,
  cells,
  categories,
  readOnly,
  onPaint,
}: {
  gridRows: number;
  gridCols: number;
  cells: Cells;
  categories: LayoutCategory[];
  readOnly: boolean;
  onPaint: (row: number, col: number) => void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [focus, setFocus] = useState({ row: 1, col: 1 });
  const painting = useRef(false);
  const lastPainted = useRef<string | null>(null);
  const onPaintRef = useRef(onPaint);
  onPaintRef.current = onPaint;

  const categoryByCode = new Map(categories.map((c) => [c.code, c]));
  const focusRow = Math.min(focus.row, gridRows);
  const focusCol = Math.min(focus.col, gridCols);

  useEffect(() => {
    const stop = () => {
      painting.current = false;
      lastPainted.current = null;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const register = useCallback((key: string, el: HTMLButtonElement | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  }, []);

  const paintOnce = useCallback(
    (row: number, col: number) => {
      if (readOnly) return;
      const key = cellKey(row, col);
      if (lastPainted.current === key) return;
      lastPainted.current = key;
      onPaintRef.current(row, col);
    },
    [readOnly],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>, row: number, col: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.focus({ preventScroll: true });
      setFocus({ row, col });
      if (readOnly) return;
      painting.current = true;
      lastPainted.current = null;
      paintOnce(row, col);
    },
    [paintOnce, readOnly],
  );

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!painting.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const target = el instanceof Element ? el.closest<HTMLElement>('[data-row][data-col]') : null;
    if (!target || !e.currentTarget.contains(target)) return;
    paintOnce(Number(target.dataset.row), Number(target.dataset.col));
  };

  const onActivate = useCallback(
    (row: number, col: number) => {
      lastPainted.current = null;
      paintOnce(row, col);
      lastPainted.current = null;
    },
    [paintOnce],
  );

  const onFocusCell = useCallback((row: number, col: number) => setFocus({ row, col }), []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, row: number, col: number) => {
      let r = row;
      let c = col;
      switch (e.key) {
        case 'ArrowUp':
          r = Math.max(1, row - 1);
          break;
        case 'ArrowDown':
          r = Math.min(gridRows, row + 1);
          break;
        case 'ArrowLeft':
          c = Math.max(1, col - 1);
          break;
        case 'ArrowRight':
          c = Math.min(gridCols, col + 1);
          break;
        case 'Home':
          c = 1;
          if (e.ctrlKey) r = 1;
          break;
        case 'End':
          c = gridCols;
          if (e.ctrlKey) r = gridRows;
          break;
        default:
          return;
      }
      e.preventDefault();
      setFocus({ row: r, col: c });
      refs.current.get(cellKey(r, c))?.focus();
    },
    [gridRows, gridCols],
  );

  const rows = Array.from({ length: gridRows }, (_, i) => i + 1);
  const cols = Array.from({ length: gridCols }, (_, i) => i + 1);

  return (
    <div className="overflow-auto rounded-md border border-line bg-canvas p-4">
      <div className="mx-auto w-max">
        <div className="mb-5 flex flex-col items-center gap-1" aria-hidden>
          <div className="h-1.5 w-[70%] rounded-full bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-subtle">Screen</span>
        </div>
        <div
          role="grid"
          aria-label="Seat layout"
          aria-rowcount={gridRows}
          aria-colcount={gridCols}
          aria-readonly={readOnly || undefined}
          onPointerMove={onPointerMove}
          className={cn('flex select-none flex-col gap-1', !readOnly && 'touch-none')}
        >
          {rows.map((r) => {
            let label = '';
            for (const c of cols) {
              const s = cells[cellKey(r, c)];
              if (s?.rowLabel) {
                label = s.rowLabel;
                break;
              }
            }
            return (
              <div role="row" key={r} aria-rowindex={r} className="flex items-center gap-1">
                <div role="rowheader" className="w-6 shrink-0 text-right text-[11px] font-semibold text-subtle">
                  {label || <span className="sr-only">Row {r}, no label</span>}
                </div>
                {cols.map((c) => {
                  const key = cellKey(r, c);
                  const seat = cells[key];
                  return (
                    <Cell
                      key={key}
                      row={r}
                      col={c}
                      seat={seat}
                      category={seat ? categoryByCode.get(seat.categoryCode) : undefined}
                      tabbable={r === focusRow && c === focusCol}
                      readOnly={readOnly}
                      register={register}
                      onKeyDown={onKeyDown}
                      onPointerDown={onPointerDown}
                      onActivate={onActivate}
                      onFocusCell={onFocusCell}
                    />
                  );
                })}
                <div className="w-6 shrink-0 text-left text-[11px] font-semibold text-subtle" aria-hidden>
                  {label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
