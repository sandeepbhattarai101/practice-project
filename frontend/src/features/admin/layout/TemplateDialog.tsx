import { useId, useState, type FormEvent } from 'react';
import { Button, Dialog, Field, FormError, Input, Select } from '@/components/ui';
import type { LayoutCategory } from '@/types/api';
import { MAX_GRID_COLS, MAX_GRID_ROWS, parseNumberList, type TemplateOptions } from './layoutUtils';

/** Collects template options; the caller generates and applies the grid. */
export function TemplateDialog({
  categories,
  initialRows,
  initialCols,
  onApply,
  onClose,
}: {
  categories: LayoutCategory[];
  initialRows: number;
  initialCols: number;
  onApply: (options: TemplateOptions) => void;
  onClose: () => void;
}) {
  const formId = useId();
  const [rows, setRows] = useState(String(initialRows));
  const [cols, setCols] = useState(String(initialCols));
  const [aisleCols, setAisleCols] = useState('');
  const [aisleAfterRow, setAisleAfterRow] = useState('');
  const [premiumRows, setPremiumRows] = useState('0');
  const [standard, setStandard] = useState(categories[0]?.code ?? '');
  const [premium, setPremium] = useState(categories[categories.length - 1]?.code ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(rows);
    const m = Number(cols);
    if (!/^\d+$/.test(rows) || n < 1 || n > MAX_GRID_ROWS) return setError(`Seat rows must be a whole number from 1 to ${MAX_GRID_ROWS}.`);
    if (!/^\d+$/.test(cols) || m < 1 || m > MAX_GRID_COLS) return setError(`Columns must be a whole number from 1 to ${MAX_GRID_COLS}.`);
    const aisles = parseNumberList(aisleCols);
    if (aisles === null) return setError('List aisle columns as numbers separated by commas, e.g. 4, 13.');
    if (aisles.some((a) => a > m)) return setError(`Aisle columns must be between 1 and ${m}.`);
    if (aisles.length >= m) return setError('Leave at least one column for seats.');
    let after: number | null = null;
    if (aisleAfterRow.trim() !== '') {
      if (!/^\d+$/.test(aisleAfterRow.trim()) || Number(aisleAfterRow) < 1 || Number(aisleAfterRow) >= n)
        return setError(`The cross aisle must come after a row from 1 to ${n - 1}.`);
      after = Number(aisleAfterRow);
      if (n + 1 > MAX_GRID_ROWS) return setError(`With a cross aisle, use at most ${MAX_GRID_ROWS - 1} seat rows.`);
    }
    if (!/^\d+$/.test(premiumRows) || Number(premiumRows) > n) return setError(`Premium rows must be between 0 and ${n}.`);
    if (!standard) return setError('Choose the category for standard rows.');
    if (Number(premiumRows) > 0 && !premium) return setError('Choose the category for the premium rows.');
    onApply({
      rows: n,
      cols: m,
      aisleCols: aisles,
      aisleAfterRow: after,
      premiumRows: Number(premiumRows),
      standardCategory: standard,
      premiumCategory: Number(premiumRows) > 0 ? premium : null,
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Generate from a template"
      description="Fills a fresh grid of seats. This replaces every seat in the current layout; nothing is saved until you press Save layout."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId}>
            Generate layout
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormError message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seat rows" required>
            {({ id }) => <Input id={id} inputMode="numeric" value={rows} onChange={(e) => setRows(e.target.value)} />}
          </Field>
          <Field label="Columns" required hint="Including aisle columns.">
            {({ id, describedBy }) => <Input id={id} inputMode="numeric" aria-describedby={describedBy} value={cols} onChange={(e) => setCols(e.target.value)} />}
          </Field>
          <Field label="Aisle columns" hint="Comma-separated, e.g. 4, 13.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={aisleCols} onChange={(e) => setAisleCols(e.target.value)} />}
          </Field>
          <Field label="Cross aisle after row" hint="Optional. Adds an empty row.">
            {({ id, describedBy }) => (
              <Input id={id} inputMode="numeric" aria-describedby={describedBy} value={aisleAfterRow} onChange={(e) => setAisleAfterRow(e.target.value)} />
            )}
          </Field>
          <Field label="Standard category" required>
            {({ id }) => (
              <Select id={id} value={standard} onChange={(e) => setStandard(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div />
          <Field label="Premium rows at the back" hint="The last N seat rows.">
            {({ id, describedBy }) => (
              <Input id={id} inputMode="numeric" aria-describedby={describedBy} value={premiumRows} onChange={(e) => setPremiumRows(e.target.value)} />
            )}
          </Field>
          <Field label="Premium category">
            {({ id }) => (
              <Select id={id} value={premium} onChange={(e) => setPremium(e.target.value)} disabled={premiumRows === '0' || premiumRows === ''}>
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
