import type { SeatLayout } from '@/types/api';
import {
  applyTool,
  cellKey,
  countSeats,
  fromLayout,
  generateTemplate,
  needsRenumber,
  parseNumberList,
  readableInk,
  removeCategory,
  renumber,
  resizeGrid,
  rowLabelFor,
  seatsOutside,
  toLayout,
  updateCategory,
  validateLayout,
  type Cells,
  type EditorSeat,
  type EditorState,
} from './layoutUtils';

const seat = (categoryCode = 'STD', extra: Partial<EditorSeat> = {}): EditorSeat => ({
  categoryCode,
  seatType: 'STANDARD',
  isActive: true,
  rowLabel: '',
  seatNumber: 0,
  ...extra,
});

const categories = [
  { code: 'STD', name: 'Standard', color: '#8a8792', sortOrder: 1 },
  { code: 'PRM', name: 'Premium', color: '#f5b544', sortOrder: 2 },
];

describe('rowLabelFor', () => {
  it('produces spreadsheet-style labels', () => {
    expect(rowLabelFor(0)).toBe('A');
    expect(rowLabelFor(25)).toBe('Z');
    expect(rowLabelFor(26)).toBe('AA');
    expect(rowLabelFor(27)).toBe('AB');
    expect(rowLabelFor(51)).toBe('AZ');
    expect(rowLabelFor(52)).toBe('BA');
  });

  it('rejects negative indexes', () => {
    expect(() => rowLabelFor(-1)).toThrow();
  });
});

describe('renumber', () => {
  it('skips aisle rows and numbers seats left to right from 1', () => {
    const cells: Cells = {
      [cellKey(1, 2)]: seat(),
      [cellKey(1, 4)]: seat(),
      // row 2 is an aisle row
      [cellKey(3, 1)]: seat(),
      [cellKey(3, 3)]: seat('STD', { isActive: false }),
      [cellKey(3, 5)]: seat(),
    };
    const out = renumber(cells, 3, 5);
    expect(out[cellKey(1, 2)]).toMatchObject({ rowLabel: 'A', seatNumber: 1 });
    expect(out[cellKey(1, 4)]).toMatchObject({ rowLabel: 'A', seatNumber: 2 });
    expect(out[cellKey(3, 1)]).toMatchObject({ rowLabel: 'B', seatNumber: 1 });
    expect(out[cellKey(3, 3)]).toMatchObject({ rowLabel: 'B', seatNumber: 2, isActive: false });
    expect(out[cellKey(3, 5)]).toMatchObject({ rowLabel: 'B', seatNumber: 3 });
  });

  it('reports when labels are stale', () => {
    const cells: Cells = { [cellKey(1, 1)]: seat('STD', { rowLabel: 'A', seatNumber: 1 }) };
    expect(needsRenumber(cells, 1, 2)).toBe(false);
    const painted = applyTool(cells, 1, 2, { kind: 'seat', categoryCode: 'STD' }, 'STD');
    expect(needsRenumber(painted, 1, 2)).toBe(true);
  });
});

describe('applyTool', () => {
  const base: Cells = { [cellKey(1, 1)]: seat('PRM', { rowLabel: 'A', seatNumber: 1 }) };

  it('paints a seat of the chosen category on an empty cell', () => {
    const out = applyTool(base, 1, 2, { kind: 'seat', categoryCode: 'STD' }, 'PRM');
    expect(out[cellKey(1, 2)]).toMatchObject({ categoryCode: 'STD', seatType: 'STANDARD', isActive: true });
  });

  it('erases with the aisle tool and is a no-op on empty cells', () => {
    expect(applyTool(base, 1, 1, { kind: 'aisle' }, 'STD')[cellKey(1, 1)]).toBeUndefined();
    expect(applyTool(base, 5, 5, { kind: 'aisle' }, 'STD')).toBe(base);
  });

  it('keeps the existing category when changing the seat type', () => {
    const out = applyTool(base, 1, 1, { kind: 'wheelchair' }, 'STD');
    expect(out[cellKey(1, 1)]).toMatchObject({ categoryCode: 'PRM', seatType: 'WHEELCHAIR', rowLabel: 'A', seatNumber: 1 });
    const couple = applyTool({}, 2, 2, { kind: 'couple' }, 'STD');
    expect(couple[cellKey(2, 2)]).toMatchObject({ categoryCode: 'STD', seatType: 'COUPLE' });
    const companion = applyTool({}, 2, 2, { kind: 'companion' }, 'STD');
    expect(companion[cellKey(2, 2)]?.seatType).toBe('COMPANION');
  });

  it('disables a seat but keeps it in the layout', () => {
    const out = applyTool(base, 1, 1, { kind: 'disabled' }, 'STD');
    expect(out[cellKey(1, 1)]).toMatchObject({ categoryCode: 'PRM', isActive: false });
    const repainted = applyTool(out, 1, 1, { kind: 'seat', categoryCode: 'PRM' }, 'STD');
    expect(repainted[cellKey(1, 1)]?.isActive).toBe(true);
  });

  it('returns the same object when the cell already matches', () => {
    expect(applyTool(base, 1, 1, { kind: 'seat', categoryCode: 'PRM' }, 'STD')).toBe(base);
  });
});

describe('resizeGrid', () => {
  it('trims seats that fall outside the new grid and clamps the size', () => {
    const state: EditorState = {
      gridRows: 3,
      gridCols: 3,
      categories,
      cells: { [cellKey(1, 1)]: seat(), [cellKey(3, 3)]: seat(), [cellKey(2, 3)]: seat() },
    };
    expect(seatsOutside(state.cells, 2, 2)).toBe(2);
    const out = resizeGrid(state, 2, 2);
    expect(out.gridRows).toBe(2);
    expect(Object.keys(out.cells)).toEqual([cellKey(1, 1)]);
    expect(resizeGrid(state, 0, 1000).gridRows).toBe(1);
  });
});

describe('generateTemplate', () => {
  it('fills rows and columns, leaves aisle columns empty and inserts an aisle row', () => {
    const out = generateTemplate({
      rows: 4,
      cols: 6,
      aisleCols: [3],
      aisleAfterRow: 2,
      premiumRows: 1,
      standardCategory: 'STD',
      premiumCategory: 'PRM',
    });
    expect(out.gridRows).toBe(5);
    expect(out.gridCols).toBe(6);
    const counts = countSeats(out.cells);
    expect(counts.total).toBe(4 * 5);
    expect(counts.byCategory).toEqual({ STD: 15, PRM: 5 });
    // aisle column and aisle row are empty
    expect(out.cells[cellKey(1, 3)]).toBeUndefined();
    expect(out.cells[cellKey(3, 1)]).toBeUndefined();
    // labels skip the aisle row; numbering skips the aisle column
    expect(out.cells[cellKey(4, 1)]).toMatchObject({ rowLabel: 'C', seatNumber: 1 });
    expect(out.cells[cellKey(5, 6)]).toMatchObject({ rowLabel: 'D', seatNumber: 5, categoryCode: 'PRM' });
  });

  it('ignores an aisle row at the edge and premium rows without a category', () => {
    const out = generateTemplate({ rows: 2, cols: 2, aisleCols: [], aisleAfterRow: 2, premiumRows: 1, standardCategory: 'STD' });
    expect(out.gridRows).toBe(2);
    expect(countSeats(out.cells).byCategory).toEqual({ STD: 4 });
  });
});

describe('toLayout / fromLayout', () => {
  it('round-trips to the API shape with 1-based cells, renumbered and sorted', () => {
    const layout: SeatLayout = {
      gridRows: 2,
      gridCols: 3,
      categories: [categories[1], categories[0]],
      seats: [
        { rowLabel: 'Z', seatNumber: 9, gridRow: 2, gridCol: 3, categoryCode: 'PRM', seatType: 'COUPLE', isActive: true },
        { rowLabel: 'Q', seatNumber: 4, gridRow: 1, gridCol: 1, categoryCode: 'STD', seatType: 'STANDARD', isActive: false },
        { rowLabel: 'X', seatNumber: 1, gridRow: 9, gridCol: 9, categoryCode: 'STD', seatType: 'STANDARD', isActive: true },
      ],
    };
    const state = fromLayout(layout);
    expect(Object.keys(state.cells)).toHaveLength(2);
    expect(state.categories.map((c) => c.code)).toEqual(['STD', 'PRM']);
    expect(toLayout(state)).toEqual({
      gridRows: 2,
      gridCols: 3,
      categories,
      seats: [
        { rowLabel: 'A', seatNumber: 1, gridRow: 1, gridCol: 1, categoryCode: 'STD', seatType: 'STANDARD', isActive: false },
        { rowLabel: 'B', seatNumber: 1, gridRow: 2, gridCol: 3, categoryCode: 'PRM', seatType: 'COUPLE', isActive: true },
      ],
    });
  });
});

describe('categories', () => {
  const state: EditorState = {
    gridRows: 1,
    gridCols: 2,
    categories,
    cells: { [cellKey(1, 1)]: seat('STD'), [cellKey(1, 2)]: seat('PRM') },
  };

  it('moves seats when a category code is renamed', () => {
    const out = updateCategory(state, 'PRM', { code: 'VIP', name: 'VIP', color: '#ffffff', sortOrder: 0 });
    expect(out.categories[0].code).toBe('VIP');
    expect(out.cells[cellKey(1, 2)]?.categoryCode).toBe('VIP');
  });

  it('refuses to remove a used category without a valid reassignment', () => {
    expect(() => removeCategory(state, 'PRM')).toThrow(/used by 1 seat/);
    expect(() => removeCategory(state, 'PRM', 'PRM')).toThrow();
    const out = removeCategory(state, 'PRM', 'STD');
    expect(out.categories.map((c) => c.code)).toEqual(['STD']);
    expect(countSeats(out.cells).byCategory).toEqual({ STD: 2 });
  });

  it('validates codes, names and orphaned seats', () => {
    expect(validateLayout(state)).toEqual([]);
    const broken: EditorState = {
      ...state,
      categories: [
        { code: 'STD', name: '', color: '#000000', sortOrder: 1 },
        { code: 'STD', name: 'Again', color: '#000000', sortOrder: 2 },
      ],
    };
    const problems = validateLayout(broken);
    expect(problems.some((p) => p.includes('unique'))).toBe(true);
    expect(problems.some((p) => p.includes('name'))).toBe(true);
    expect(problems.some((p) => p.includes('no longer exists'))).toBe(true);
  });
});

describe('parseNumberList', () => {
  it('parses, de-duplicates and sorts', () => {
    expect(parseNumberList('10, 3, ,3')).toEqual([3, 10]);
    expect(parseNumberList('')).toEqual([]);
    expect(parseNumberList('2, x')).toBeNull();
    expect(parseNumberList('0')).toBeNull();
  });
});

describe('readableInk', () => {
  it('picks dark ink on light colours and light ink on dark ones', () => {
    expect(readableInk('#f5b544')).toBe('#07070a');
    expect(readableInk('#ffffff')).toBe('#07070a');
    expect(readableInk('#1c1c25')).toBe('#f3efe8');
    expect(readableInk('#000')).toBe('#f3efe8');
    expect(readableInk('not a colour')).toBe('#f3efe8');
  });
});
