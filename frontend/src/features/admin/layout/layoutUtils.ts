/**
 * Pure seat-layout logic for the admin layout editor. No React here so it can be unit tested.
 *
 * Grid coordinates are 1-based (`gridRow`, `gridCol`), matching the API. A cell without a seat is an aisle.
 */
import type { LayoutCategory, LayoutSeat, LayoutSeatType, SeatLayout } from '@/types/api';

export const MAX_GRID_ROWS = 40;
export const MAX_GRID_COLS = 60;

export interface EditorSeat {
  categoryCode: string;
  seatType: LayoutSeatType;
  isActive: boolean;
  /** Labels as last saved or renumbered. Empty for freshly painted seats until renumbered. */
  rowLabel: string;
  seatNumber: number;
}

export type Cells = Readonly<Record<string, EditorSeat>>;

export interface EditorState {
  gridRows: number;
  gridCols: number;
  categories: LayoutCategory[];
  cells: Cells;
}

export type Tool =
  | { kind: 'seat'; categoryCode: string }
  | { kind: 'aisle' }
  | { kind: 'wheelchair' }
  | { kind: 'couple' }
  | { kind: 'companion' }
  | { kind: 'disabled' };

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function parseCellKey(key: string): { row: number; col: number } {
  const [r, c] = key.split(':');
  return { row: Number(r), col: Number(c) };
}

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB" (spreadsheet-style). */
export function rowLabelFor(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid row index: ${index}`);
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** Builds editor state from an API layout. Seats outside the grid are dropped. */
export function fromLayout(layout: SeatLayout): EditorState {
  const cells: Record<string, EditorSeat> = {};
  for (const s of layout.seats) {
    if (s.gridRow < 1 || s.gridCol < 1 || s.gridRow > layout.gridRows || s.gridCol > layout.gridCols) continue;
    cells[cellKey(s.gridRow, s.gridCol)] = {
      categoryCode: s.categoryCode,
      seatType: s.seatType,
      isActive: s.isActive,
      rowLabel: s.rowLabel,
      seatNumber: s.seatNumber,
    };
  }
  return {
    gridRows: layout.gridRows,
    gridCols: layout.gridCols,
    categories: sortCategories(layout.categories),
    cells,
  };
}

export function sortCategories(categories: LayoutCategory[]): LayoutCategory[] {
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

/**
 * Relabels every seat: rows that contain at least one seat get A, B, C… top to bottom
 * (rows with no seats are aisle rows and are skipped); seats are numbered 1… left to right per row.
 * Inactive (disabled) seats still take a label and number so the physical numbering stays stable.
 */
export function renumber(cells: Cells, gridRows: number, gridCols: number): Cells {
  const out: Record<string, EditorSeat> = {};
  let labelIndex = 0;
  for (let r = 1; r <= gridRows; r++) {
    let number = 0;
    let label: string | null = null;
    for (let c = 1; c <= gridCols; c++) {
      const seat = cells[cellKey(r, c)];
      if (!seat) continue;
      if (label === null) label = rowLabelFor(labelIndex);
      number += 1;
      out[cellKey(r, c)] = { ...seat, rowLabel: label, seatNumber: number };
    }
    if (label !== null) labelIndex += 1;
  }
  return out;
}

/** True when the stored labels differ from what `renumber` would produce. */
export function needsRenumber(cells: Cells, gridRows: number, gridCols: number): boolean {
  const fresh = renumber(cells, gridRows, gridCols);
  return Object.entries(fresh).some(([key, seat]) => {
    const current = cells[key];
    return !current || current.rowLabel !== seat.rowLabel || current.seatNumber !== seat.seatNumber;
  });
}

/** The API body for PUT /admin/auditoriums/{id}/layout, renumbered and sorted row-major. */
export function toLayout(state: EditorState): SeatLayout {
  const cells = renumber(state.cells, state.gridRows, state.gridCols);
  const seats: LayoutSeat[] = Object.entries(cells)
    .map(([key, s]) => {
      const { row, col } = parseCellKey(key);
      return {
        rowLabel: s.rowLabel,
        seatNumber: s.seatNumber,
        gridRow: row,
        gridCol: col,
        categoryCode: s.categoryCode,
        seatType: s.seatType,
        isActive: s.isActive,
      };
    })
    .sort((a, b) => a.gridRow - b.gridRow || a.gridCol - b.gridCol);
  return {
    gridRows: state.gridRows,
    gridCols: state.gridCols,
    categories: sortCategories(state.categories).map(({ code, name, color, sortOrder }) => ({ code, name, color, sortOrder })),
    seats,
  };
}

/**
 * Applies a palette tool to one cell. `fallbackCategory` is used when a tool creates a seat
 * on an empty cell (wheelchair, couple, companion, disabled). Returns the same object when nothing changes.
 */
export function applyTool(cells: Cells, row: number, col: number, tool: Tool, fallbackCategory: string): Cells {
  const key = cellKey(row, col);
  const current = cells[key];
  const base: EditorSeat = current ?? { categoryCode: fallbackCategory, seatType: 'STANDARD', isActive: true, rowLabel: '', seatNumber: 0 };
  let next: EditorSeat | undefined;
  switch (tool.kind) {
    case 'aisle':
      if (!current) return cells;
      next = undefined;
      break;
    case 'seat':
      next = { ...base, categoryCode: tool.categoryCode, seatType: 'STANDARD', isActive: true };
      break;
    case 'wheelchair':
      next = { ...base, seatType: 'WHEELCHAIR', isActive: true };
      break;
    case 'couple':
      next = { ...base, seatType: 'COUPLE', isActive: true };
      break;
    case 'companion':
      next = { ...base, seatType: 'COMPANION', isActive: true };
      break;
    case 'disabled':
      next = { ...base, isActive: false };
      break;
  }
  if (next && current && sameSeat(current, next)) return cells;
  const out: Record<string, EditorSeat> = { ...cells };
  if (next) out[key] = next;
  else delete out[key];
  return out;
}

function sameSeat(a: EditorSeat, b: EditorSeat): boolean {
  return (
    a.categoryCode === b.categoryCode &&
    a.seatType === b.seatType &&
    a.isActive === b.isActive &&
    a.rowLabel === b.rowLabel &&
    a.seatNumber === b.seatNumber
  );
}

/** Changes the grid size, dropping any seat that falls outside it. */
export function resizeGrid(state: EditorState, gridRows: number, gridCols: number): EditorState {
  const rows = clampInt(gridRows, 1, MAX_GRID_ROWS);
  const cols = clampInt(gridCols, 1, MAX_GRID_COLS);
  const cells: Record<string, EditorSeat> = {};
  for (const [key, seat] of Object.entries(state.cells)) {
    const { row, col } = parseCellKey(key);
    if (row <= rows && col <= cols) cells[key] = seat;
  }
  return { ...state, gridRows: rows, gridCols: cols, cells };
}

/** Number of seats a resize to rows × cols would remove. */
export function seatsOutside(cells: Cells, gridRows: number, gridCols: number): number {
  return Object.keys(cells).filter((key) => {
    const { row, col } = parseCellKey(key);
    return row > gridRows || col > gridCols;
  }).length;
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export interface SeatCounts {
  total: number;
  active: number;
  inactive: number;
  byCategory: Record<string, number>;
  byType: Record<LayoutSeatType, number>;
}

export function countSeats(cells: Cells): SeatCounts {
  const counts: SeatCounts = {
    total: 0,
    active: 0,
    inactive: 0,
    byCategory: {},
    byType: { STANDARD: 0, WHEELCHAIR: 0, COMPANION: 0, COUPLE: 0 },
  };
  for (const seat of Object.values(cells)) {
    counts.total += 1;
    if (seat.isActive) counts.active += 1;
    else counts.inactive += 1;
    counts.byCategory[seat.categoryCode] = (counts.byCategory[seat.categoryCode] ?? 0) + 1;
    counts.byType[seat.seatType] += 1;
  }
  return counts;
}

/** Moves every seat in category `from` to category `to`. */
export function reassignCategory(cells: Cells, from: string, to: string): Cells {
  const out: Record<string, EditorSeat> = {};
  for (const [key, seat] of Object.entries(cells)) out[key] = seat.categoryCode === from ? { ...seat, categoryCode: to } : seat;
  return out;
}

/**
 * Replaces the category with code `originalCode` by `next`. When the code itself changes,
 * seats using the old code follow it.
 */
export function updateCategory(state: EditorState, originalCode: string, next: LayoutCategory): EditorState {
  const categories = sortCategories(state.categories.map((c) => (c.code === originalCode ? next : c)));
  const cells = next.code === originalCode ? state.cells : reassignCategory(state.cells, originalCode, next.code);
  return { ...state, categories, cells };
}

/** Removes a category. Seats using it move to `reassignTo`; without one, a used category is not removed. */
export function removeCategory(state: EditorState, code: string, reassignTo?: string): EditorState {
  const used = countSeats(state.cells).byCategory[code] ?? 0;
  if (used > 0 && (!reassignTo || reassignTo === code || !state.categories.some((c) => c.code === reassignTo))) {
    throw new Error(`Category ${code} is used by ${used} seat(s); choose another category for them first.`);
  }
  const cells = used > 0 && reassignTo ? reassignCategory(state.cells, code, reassignTo) : state.cells;
  return { ...state, categories: state.categories.filter((c) => c.code !== code), cells };
}

/** "3, 10,  ,12" → [3, 10, 12]. Returns null when any part is not a positive whole number. */
export function parseNumberList(text: string): number[] | null {
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 1) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

export interface TemplateOptions {
  /** Seat rows (excluding any aisle row). */
  rows: number;
  /** Grid columns, including aisle columns. */
  cols: number;
  /** 1-based grid columns left empty as aisles. */
  aisleCols: number[];
  /** When set, an empty grid row is inserted after this many seat rows. */
  aisleAfterRow?: number | null;
  /** The last N seat rows use `premiumCategory`. */
  premiumRows: number;
  standardCategory: string;
  premiumCategory?: string | null;
}

/** Fills a fresh grid from the template options and labels it. */
export function generateTemplate(options: TemplateOptions): { gridRows: number; gridCols: number; cells: Cells } {
  const rows = clampInt(options.rows, 1, MAX_GRID_ROWS);
  const aisleAfter =
    options.aisleAfterRow && options.aisleAfterRow > 0 && options.aisleAfterRow < rows ? Math.round(options.aisleAfterRow) : null;
  const gridRows = Math.min(MAX_GRID_ROWS, rows + (aisleAfter ? 1 : 0));
  const gridCols = clampInt(options.cols, 1, MAX_GRID_COLS);
  const aisles = new Set(options.aisleCols);
  const premiumRows = clampInt(options.premiumRows, 0, rows);
  const premium = options.premiumCategory && premiumRows > 0 ? options.premiumCategory : null;

  const cells: Record<string, EditorSeat> = {};
  let seatRow = 0;
  for (let gridRow = 1; gridRow <= gridRows; gridRow++) {
    if (aisleAfter !== null && gridRow === aisleAfter + 1) continue;
    seatRow += 1;
    if (seatRow > rows) break;
    const categoryCode = premium && seatRow > rows - premiumRows ? premium : options.standardCategory;
    for (let c = 1; c <= gridCols; c++) {
      if (aisles.has(c)) continue;
      cells[cellKey(gridRow, c)] = { categoryCode, seatType: 'STANDARD', isActive: true, rowLabel: '', seatNumber: 0 };
    }
  }
  return { gridRows, gridCols, cells: renumber(cells, gridRows, gridCols) };
}

/** Problems that would make the server reject the layout, as readable sentences. */
export function validateLayout(state: EditorState): string[] {
  const problems: string[] = [];
  const codes = state.categories.map((c) => c.code.trim());
  if (state.categories.length === 0) problems.push('Add at least one seat category.');
  if (codes.some((c) => c === '')) problems.push('Every category needs a code.');
  const dupes = codes.filter((c, i) => c !== '' && codes.indexOf(c) !== i);
  if (dupes.length > 0) problems.push(`Category codes must be unique (duplicated: ${[...new Set(dupes)].join(', ')}).`);
  if (state.categories.some((c) => c.name.trim() === '')) problems.push('Every category needs a name.');
  const known = new Set(codes);
  const orphan = Object.values(state.cells).filter((s) => !known.has(s.categoryCode)).length;
  if (orphan > 0) problems.push(`${orphan} seat(s) use a category that no longer exists.`);
  if (Object.keys(state.cells).length === 0) problems.push('The layout has no seats.');
  return problems;
}

/** Suggests the next unused category code, e.g. "CAT3". */
export function nextCategoryCode(categories: LayoutCategory[]): string {
  const used = new Set(categories.map((c) => c.code));
  let i = categories.length + 1;
  while (used.has(`CAT${i}`)) i += 1;
  return `CAT${i}`;
}

/** Stable signature used to detect unsaved changes. */
export function layoutSignature(state: EditorState): string {
  return JSON.stringify(toLayout(state));
}

/** Dark or light ink for text drawn on a category colour, by relative luminance. */
export function readableInk(hex: string): '#07070a' | '#f3efe8' {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return '#f3efe8';
  const full = m[1].length === 3 ? [...m[1]].map((ch) => ch + ch).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.25 ? '#07070a' : '#f3efe8';
}

/** A tidy default colour for a new category, cycling through a small set. */
export const CATEGORY_COLOURS = ['#8a8792', '#f5b544', '#7aa7f0', '#5cc98d', '#c58af0', '#f0913c'];
