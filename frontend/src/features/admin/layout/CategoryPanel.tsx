import { useId, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Dialog, Field, FormError, Input, Select, useConfirm } from '@/components/ui';
import type { LayoutCategory } from '@/types/api';
import { CATEGORY_COLOURS, nextCategoryCode } from './layoutUtils';

function CategoryDialog({
  category,
  categories,
  onSave,
  onClose,
}: {
  category: LayoutCategory | null;
  categories: LayoutCategory[];
  onSave: (next: LayoutCategory) => void;
  onClose: () => void;
}) {
  const formId = useId();
  const [code, setCode] = useState(category?.code ?? nextCategoryCode(categories));
  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLOURS[categories.length % CATEGORY_COLOURS.length]);
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? categories.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1));
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,20}$/.test(c)) return setError('The code must be 1–20 capital letters, digits or underscores, e.g. PREMIUM.');
    if (categories.some((x) => x.code === c && x.code !== category?.code)) return setError(`Another category already uses the code ${c}.`);
    if (name.trim() === '') return setError('Enter a name for the category.');
    if (!/^-?\d+$/.test(sortOrder.trim())) return setError('The sort order must be a whole number.');
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return setError('Choose a colour.');
    onSave({ code: c, name: name.trim(), color, sortOrder: Number(sortOrder) });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={category ? `Edit ${category.name}` : 'New seat category'}
      description="Categories set the price band of a seat. Prices are set per showtime."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId}>
            {category ? 'Update category' : 'Add category'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormError message={error} />
        <Field label="Name" required>
          {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Premium" />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" required hint="Saved with each seat.">
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono uppercase" />
            )}
          </Field>
          <Field label="Sort order" hint="Lower comes first.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />}
          </Field>
        </div>
        <Field label="Colour">
          {({ id }) => (
            <div className="flex items-center gap-3">
              <input
                id={id}
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-md border border-line bg-surface p-1"
              />
              <code className="text-xs text-muted">{color}</code>
            </div>
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function ReassignDialog({
  category,
  count,
  others,
  onConfirm,
  onClose,
}: {
  category: LayoutCategory;
  count: number;
  others: LayoutCategory[];
  onConfirm: (to: string) => void;
  onClose: () => void;
}) {
  const [to, setTo] = useState(others[0]?.code ?? '');
  return (
    <Dialog
      open
      onClose={onClose}
      role="alertdialog"
      size="sm"
      title={`Remove ${category.name}?`}
      description={`${count} ${count === 1 ? 'seat uses' : 'seats use'} this category. Choose where to move ${count === 1 ? 'it' : 'them'} before it is removed.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => onConfirm(to)} disabled={!to}>
            Move seats and remove
          </Button>
        </>
      }
    >
      <Field label="Move seats to">
        {({ id }) => (
          <Select id={id} value={to} onChange={(e) => setTo(e.target.value)}>
            {others.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Dialog>
  );
}

export function CategoryPanel({
  categories,
  counts,
  readOnly,
  onAdd,
  onUpdate,
  onRemove,
}: {
  categories: LayoutCategory[];
  counts: Record<string, number>;
  readOnly: boolean;
  onAdd: (c: LayoutCategory) => void;
  onUpdate: (originalCode: string, c: LayoutCategory) => void;
  onRemove: (code: string, reassignTo?: string) => void;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ category: LayoutCategory | null } | null>(null);
  const [removing, setRemoving] = useState<LayoutCategory | null>(null);

  const remove = async (c: LayoutCategory) => {
    const used = counts[c.code] ?? 0;
    if (used > 0) {
      setRemoving(c);
      return;
    }
    const ok = await confirm({ title: `Remove ${c.name}?`, description: 'No seats use this category.', confirmLabel: 'Remove', tone: 'danger' });
    if (ok) onRemove(c.code);
  };

  return (
    <div>
      <ul className="flex flex-col divide-y divide-line">
        {categories.map((c) => {
          const used = counts[c.code] ?? 0;
          const onlyOne = categories.length === 1 && used > 0;
          return (
            <li key={c.code} className="flex items-center gap-2.5 py-2 first:pt-0">
              <span className="size-4 shrink-0 rounded-xs" style={{ backgroundColor: c.color }} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{c.name}</p>
                <p className="text-[11px] text-subtle">
                  <code>{c.code}</code> · order {c.sortOrder} · {used} {used === 1 ? 'seat' : 'seats'}
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setEditing({ category: c })} disabled={readOnly} aria-label={`Edit category ${c.name}`}>
                <Pencil className="size-3.5" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="hover:text-danger"
                onClick={() => remove(c)}
                disabled={readOnly || onlyOne}
                title={onlyOne ? 'Add another category first, so its seats have somewhere to go' : undefined}
                aria-label={`Remove category ${c.name}`}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
      {categories.length === 0 && <p className="text-sm text-subtle">No categories yet. Add one before painting seats.</p>}
      <Button
        variant="secondary"
        size="sm"
        className="mt-3 w-full"
        onClick={() => setEditing({ category: null })}
        disabled={readOnly}
        leftIcon={<Plus className="size-3.5" aria-hidden />}
      >
        Add category
      </Button>

      {editing && (
        <CategoryDialog
          key={editing.category?.code ?? 'new'}
          category={editing.category}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            if (editing.category) onUpdate(editing.category.code, next);
            else onAdd(next);
            setEditing(null);
          }}
        />
      )}
      {removing && (
        <ReassignDialog
          category={removing}
          count={counts[removing.code] ?? 0}
          others={categories.filter((c) => c.code !== removing.code)}
          onClose={() => setRemoving(null)}
          onConfirm={(to) => {
            onRemove(removing.code, to);
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}
