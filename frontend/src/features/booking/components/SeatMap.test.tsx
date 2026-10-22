import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeatMap, seatAriaLabel } from './SeatMap';
import type { Seat, SeatCategory, SeatMap as SeatMapData } from '@/types/api';

const categories: SeatCategory[] = [
  { id: 1, code: 'STD', name: 'Standard', color: '#8899aa', priceMinor: 35000 },
  { id: 2, code: 'PRM', name: 'Premium', color: '#f5b544', priceMinor: 45000 },
];

let nextId = 100;
function seat(row: string, gridRow: number, gridCol: number, number: number, extra: Partial<Seat> = {}): Seat {
  return { id: nextId++, label: `${row}${number}`, rowLabel: row, number, gridRow, gridCol, categoryId: 1, type: 'STANDARD', state: 'AVAILABLE', ...extra };
}

/**
 * 3 rows × 5 columns. Column 3 is an aisle; grid row 2 is an empty aisle row.
 *   row1 (A): A1 A2 _ A3(sold) A4(held)
 *   row2:     (aisle)
 *   row3 (B): B1(wheelchair) B2 _ B3(premium) B4(unavailable)
 */
function buildMap(): Pick<SeatMapData, 'gridRows' | 'gridCols' | 'seats' | 'categories'> {
  nextId = 100;
  return {
    gridRows: 3,
    gridCols: 5,
    categories,
    seats: [
      seat('A', 1, 1, 1),
      seat('A', 1, 2, 2),
      seat('A', 1, 4, 3, { state: 'SOLD' }),
      seat('A', 1, 5, 4, { state: 'HELD' }),
      seat('B', 3, 1, 1, { type: 'WHEELCHAIR' }),
      seat('B', 3, 2, 2),
      seat('B', 3, 4, 3, { categoryId: 2 }),
      seat('B', 3, 5, 4, { state: 'UNAVAILABLE' }),
    ],
  };
}

function Harness({ maxSeats = 3, onLimit = () => {}, initial = [] as number[] }) {
  const [selected, setSelected] = useState<number[]>(initial);
  return (
    <>
      <SeatMap map={buildMap()} selected={selected} onChange={setSelected} maxSeats={maxSeats} onLimitReached={onLimit} />
      <output data-testid="selected">{selected.join(',')}</output>
    </>
  );
}

const seatButton = (label: string) => screen.getByRole('button', { name: new RegExp(`^Seat ${label},`) });

describe('SeatMap', () => {
  it('renders one button per seat and leaves aisles empty', () => {
    const { container } = render(<Harness />);
    const group = screen.getByRole('group', { name: /seat map/i });
    expect(within(group).getAllByRole('button')).toHaveLength(8);
    // Seats are placed at gridCol + 1 (column 1 holds the row label), so the aisle column 3 → grid column 4 is empty.
    const placed = Array.from(container.querySelectorAll<HTMLElement>('[data-seat-id]')).map((el) => `${el.style.gridRow}:${el.style.gridColumn}`);
    expect(placed).not.toContain('1:4');
    expect(placed).toContain('1:5');
    // Row 2 is an aisle row: no seats in it.
    expect(placed.some((p) => p.startsWith('2:'))).toBe(false);
  });

  it('shows row labels on both sides', () => {
    const { container } = render(<Harness />);
    const labels = Array.from(container.querySelectorAll('[aria-hidden="true"]'))
      .map((el) => el.textContent)
      .filter((t) => t === 'A' || t === 'B');
    expect(labels).toEqual(['A', 'A', 'B', 'B']);
  });

  it('labels seats with row, number, category, price and state', () => {
    render(<Harness />);
    expect(seatButton('A1')).toHaveAccessibleName('Seat A1, Standard, Rs. 350, available');
    expect(seatButton('B3')).toHaveAccessibleName('Seat B3, Premium, Rs. 450, available');
    expect(seatButton('A3')).toHaveAccessibleName('Seat A3, Standard, Rs. 350, sold');
    expect(seatButton('A4')).toHaveAccessibleName('Seat A4, Standard, Rs. 350, held by another customer');
    expect(seatButton('B1')).toHaveAccessibleName('Seat B1, Standard, Rs. 350, wheelchair space, available');
    expect(seatButton('B4')).toHaveAccessibleName('Seat B4, Standard, Rs. 350, unavailable');
  });

  it('selects and deselects a seat', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const a1 = seatButton('A1');
    expect(a1).toHaveAttribute('aria-pressed', 'false');
    await user.click(a1);
    expect(seatButton('A1')).toHaveAttribute('aria-pressed', 'true');
    expect(seatButton('A1')).toHaveAccessibleName(/selected$/);
    expect(screen.getByTestId('selected').textContent).toBe('100');
    await user.click(seatButton('A1'));
    expect(seatButton('A1')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('selected').textContent).toBe('');
  });

  it('does not select sold, held or unavailable seats', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    for (const label of ['A3', 'A4', 'B4']) {
      const btn = seatButton(label);
      expect(btn).toHaveAttribute('aria-disabled', 'true');
      expect(btn).not.toHaveAttribute('aria-pressed');
      await user.click(btn);
    }
    expect(screen.getByTestId('selected').textContent).toBe('');
  });

  it('enforces the maximum number of seats', async () => {
    const user = userEvent.setup();
    const onLimit = vi.fn();
    render(<Harness maxSeats={2} onLimit={onLimit} />);
    await user.click(seatButton('A1'));
    await user.click(seatButton('A2'));
    await user.click(seatButton('B2'));
    expect(onLimit).toHaveBeenCalledWith(2);
    expect(screen.getByTestId('selected').textContent).toBe('100,101');
    expect(seatButton('B2')).toHaveAttribute('aria-pressed', 'false');
    // Deselecting frees a slot again.
    await user.click(seatButton('A1'));
    await user.click(seatButton('B2'));
    expect(screen.getByTestId('selected').textContent).toBe('101,105');
  });

  it('treats seats in my own hold (MINE) as selectable', () => {
    const map = buildMap();
    map.seats[0].state = 'MINE';
    render(<SeatMap map={map} selected={[map.seats[0].id]} onChange={() => {}} maxSeats={4} />);
    expect(seatButton('A1')).toHaveAttribute('aria-pressed', 'true');
  });

  it('supports arrow-key navigation with a single tab stop', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const group = screen.getByRole('group', { name: /seat map/i });
    const tabbable = within(group).getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(seatButton('A1'));

    seatButton('A1').focus();
    await user.keyboard('{ArrowRight}');
    expect(seatButton('A2')).toHaveFocus();
    await user.keyboard('{ArrowRight}'); // skips the aisle to A3
    expect(seatButton('A3')).toHaveFocus();
    await user.keyboard('{ArrowDown}'); // skips the empty aisle row to B3 (nearest column)
    expect(seatButton('B3')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(seatButton('B1')).toHaveFocus();
    await user.keyboard(' ');
    expect(seatButton('B1')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('seatAriaLabel', () => {
  it('mentions couple seats', () => {
    const s = seat('C', 1, 1, 1, { type: 'COUPLE' });
    expect(seatAriaLabel(s, categories[1], false)).toBe('Seat C1, Premium, Rs. 450, couple seat, available');
  });
});
