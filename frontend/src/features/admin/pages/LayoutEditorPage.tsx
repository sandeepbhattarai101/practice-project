import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Accessibility, ArrowLeft, Ban, Eraser, Heart, ListOrdered, Lock, RotateCcw, Save, Users, WandSparkles } from 'lucide-react';
import { Button, ButtonLink, EmptyState, ErrorState, Field, FormError, Input, LoadingRegion, Skeleton, toast, useConfirm } from '@/components/ui';
import { ApiError, errorMessage, isApiErrorCode } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/hooks';
import type { LayoutCategory, SeatLayoutResponse } from '@/types/api';
import { adminApi, adminKeys } from '../api';
import { AdminPageHeader, Panel } from '../components/AdminUi';
import { CategoryPanel } from '../layout/CategoryPanel';
import { SeatGrid } from '../layout/SeatGrid';
import { TemplateDialog } from '../layout/TemplateDialog';
import {
  MAX_GRID_COLS,
  MAX_GRID_ROWS,
  applyTool,
  countSeats,
  fromLayout,
  generateTemplate,
  layoutSignature,
  needsRenumber,
  removeCategory,
  renumber,
  resizeGrid,
  seatsOutside,
  sortCategories,
  toLayout,
  updateCategory,
  validateLayout,
  type EditorState,
  type Tool,
} from '../layout/layoutUtils';

const LOCKED_MESSAGE =
  'This layout is locked because upcoming showtimes on this screen already have seats held or sold. Changing seats now would break those bookings. ' +
  'Wait until those shows have finished, or cancel them from Showtimes, before editing the layout.';

type ToolKind = Tool['kind'];

const typeTools: { kind: Exclude<ToolKind, 'seat'>; label: string; hint: string; icon: ReactNode }[] = [
  { kind: 'aisle', label: 'Aisle', hint: 'Erase: leaves the cell empty', icon: <Eraser className="size-3.5" aria-hidden /> },
  { kind: 'wheelchair', label: 'Wheelchair', hint: 'Wheelchair space', icon: <Accessibility className="size-3.5" aria-hidden /> },
  { kind: 'companion', label: 'Companion', hint: 'Seat for a wheelchair user’s companion', icon: <Users className="size-3.5" aria-hidden /> },
  { kind: 'couple', label: 'Couple', hint: 'Double seat', icon: <Heart className="size-3.5" aria-hidden /> },
  { kind: 'disabled', label: 'Disabled', hint: 'Seat exists but cannot be sold', icon: <Ban className="size-3.5" aria-hidden /> },
];

function ToolButton({ pressed, onClick, children, title, disabled }: { pressed: boolean; onClick: () => void; children: ReactNode; title: string; disabled: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        pressed ? 'border-accent bg-accent-soft text-fg' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function Editor({ auditoriumId, initial }: { auditoriumId: number; initial: SeatLayoutResponse }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [state, setState] = useState<EditorState>(() => fromLayout(initial));
  const [savedSignature, setSavedSignature] = useState(() => layoutSignature(fromLayout(initial)));
  const [locked, setLocked] = useState(initial.locked);
  const [toolKind, setToolKind] = useState<ToolKind>('seat');
  const [category, setCategory] = useState(() => sortCategories(initial.categories)[0]?.code ?? '');
  const [rowsDraft, setRowsDraft] = useState(String(initial.gridRows));
  const [colsDraft, setColsDraft] = useState(String(initial.gridCols));
  const [templateOpen, setTemplateOpen] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const signature = useMemo(() => layoutSignature(state), [state]);
  const dirty = signature !== savedSignature;
  const counts = useMemo(() => countSeats(state.cells), [state.cells]);
  const stale = useMemo(() => needsRenumber(state.cells, state.gridRows, state.gridCols), [state]);
  const activeCategory = state.categories.some((c) => c.code === category) ? category : (state.categories[0]?.code ?? '');
  const readOnly = locked;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const tool: Tool = toolKind === 'seat' ? { kind: 'seat', categoryCode: activeCategory } : { kind: toolKind };

  const paint = (row: number, col: number) => {
    if (readOnly) return;
    if (!activeCategory && tool.kind !== 'aisle') {
      toast.error('Add a seat category before painting seats.');
      return;
    }
    setState((s) => {
      const cells = applyTool(s.cells, row, col, tool, activeCategory);
      return cells === s.cells ? s : { ...s, cells };
    });
  };

  const applySize = async () => {
    const rows = Number(rowsDraft);
    const cols = Number(colsDraft);
    if (!Number.isInteger(rows) || rows < 1 || rows > MAX_GRID_ROWS || !Number.isInteger(cols) || cols < 1 || cols > MAX_GRID_COLS) {
      toast.error(`Use 1–${MAX_GRID_ROWS} rows and 1–${MAX_GRID_COLS} columns.`);
      return;
    }
    const lost = seatsOutside(state.cells, rows, cols);
    if (lost > 0) {
      const ok = await confirm({
        title: 'Remove seats outside the grid?',
        description: `${lost} ${lost === 1 ? 'seat lies' : 'seats lie'} outside a ${rows} × ${cols} grid and will be removed.`,
        confirmLabel: 'Resize and remove',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setState((s) => resizeGrid(s, rows, cols));
  };

  const reset = async () => {
    const ok = await confirm({ title: 'Discard your changes?', description: 'The layout returns to how it was last saved.', confirmLabel: 'Discard changes', tone: 'danger' });
    if (!ok) return;
    const fresh = fromLayout(queryClient.getQueryData<SeatLayoutResponse>(adminKeys.layout(auditoriumId)) ?? initial);
    setState(fresh);
    setRowsDraft(String(fresh.gridRows));
    setColsDraft(String(fresh.gridCols));
    setProblems([]);
    setSaveError(null);
  };

  const save = useMutation({
    mutationFn: () => adminApi.saveLayout(auditoriumId, toLayout(state)),
    onSuccess: (response) => {
      const next = response && Array.isArray(response.seats) ? fromLayout(response) : { ...state, cells: renumber(state.cells, state.gridRows, state.gridCols) };
      if (response && Array.isArray(response.seats)) {
        queryClient.setQueryData(adminKeys.layout(auditoriumId), response);
        setLocked(Boolean(response.locked));
      } else {
        queryClient.invalidateQueries({ queryKey: adminKeys.layout(auditoriumId) });
      }
      setState(next);
      setSavedSignature(layoutSignature(next));
      queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'cinema'] });
      queryClient.invalidateQueries({ queryKey: adminKeys.cinemas() });
      queryClient.invalidateQueries({ queryKey: adminKeys.lookups() });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      setSaveError(null);
      toast.success(`Layout saved: ${countSeats(next.cells).total} seats.`);
    },
    onError: (error) => {
      if (isApiErrorCode(error, 'LAYOUT_LOCKED')) {
        setLocked(true);
        setSaveError(`Your changes were not saved. ${LOCKED_MESSAGE}`);
      } else {
        const detail = error instanceof ApiError ? error.fieldErrors.map((f) => `${f.field}: ${f.message}`).join('; ') : '';
        setSaveError(`The layout was not saved. ${errorMessage(error)}${detail ? ` (${detail})` : ''}`);
      }
    },
  });

  const onSave = () => {
    const found = validateLayout(state);
    setProblems(found);
    if (found.length > 0) return;
    setSaveError(null);
    save.mutate();
  };

  const onTemplate = async (options: Parameters<typeof generateTemplate>[0]) => {
    if (counts.total > 0) {
      const ok = await confirm({
        title: 'Replace the current seats?',
        description: `The ${counts.total} seats in the current layout will be replaced by the template.`,
        confirmLabel: 'Replace seats',
        tone: 'danger',
      });
      if (!ok) return;
    }
    const generated = generateTemplate(options);
    setState((s) => ({ ...s, ...generated }));
    setRowsDraft(String(generated.gridRows));
    setColsDraft(String(generated.gridCols));
    setTemplateOpen(false);
  };

  const onAddCategory = (c: LayoutCategory) => {
    setState((s) => ({ ...s, categories: sortCategories([...s.categories, c]) }));
    setCategory(c.code);
    setToolKind('seat');
  };

  const onUpdateCategory = (originalCode: string, c: LayoutCategory) => {
    setState((s) => updateCategory(s, originalCode, c));
    if (category === originalCode) setCategory(c.code);
  };

  const onRemoveCategory = (code: string, reassignTo?: string) => {
    try {
      setState(removeCategory(state, code, reassignTo));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The category could not be removed.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {locked && (
        <div role="alert" className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-fg">
          <Lock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="font-semibold">Editing is disabled</p>
            <p className="mt-0.5 text-muted">{LOCKED_MESSAGE}</p>
          </div>
        </div>
      )}
      <FormError message={saveError} />
      {problems.length > 0 && (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-fg">
          <p className="font-semibold">Fix these before saving:</p>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setTemplateOpen(true)} disabled={readOnly || state.categories.length === 0} leftIcon={<WandSparkles className="size-3.5" aria-hidden />}>
            Generate template
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setState((s) => ({ ...s, cells: renumber(s.cells, s.gridRows, s.gridCols) }))}
            disabled={readOnly || !stale}
            leftIcon={<ListOrdered className="size-3.5" aria-hidden />}
          >
            Auto-renumber
          </Button>
          {stale && !readOnly && <span className="text-xs text-warning">Seat numbers are out of date; they are renumbered when you save.</span>}
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-warning" aria-live="polite">Unsaved changes</span>}
          <Button variant="ghost" size="sm" onClick={reset} disabled={!dirty || save.isPending} leftIcon={<RotateCcw className="size-3.5" aria-hidden />}>
            Discard
          </Button>
          <Button size="sm" onClick={onSave} loading={save.isPending} disabled={readOnly || !dirty} leftIcon={<Save className="size-3.5" aria-hidden />}>
            Save layout
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3" role="group" aria-label="Painting tools">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">Seat</span>
              {state.categories.map((c) => (
                <ToolButton
                  key={c.code}
                  pressed={toolKind === 'seat' && activeCategory === c.code}
                  onClick={() => {
                    setCategory(c.code);
                    setToolKind('seat');
                  }}
                  title={`Paint ${c.name} seats`}
                  disabled={readOnly}
                >
                  <span className="size-3 rounded-[3px]" style={{ backgroundColor: c.color }} aria-hidden />
                  {c.name}
                </ToolButton>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">Type</span>
              {typeTools.map((t) => (
                <ToolButton key={t.kind} pressed={toolKind === t.kind} onClick={() => setToolKind(t.kind)} title={t.hint} disabled={readOnly}>
                  {t.icon}
                  {t.label}
                </ToolButton>
              ))}
            </div>
            <p className="text-xs text-subtle">
              Click or drag across cells to paint. With the keyboard, tab into the grid, move with the arrow keys and press Enter or Space to paint.
              {toolKind !== 'seat' && toolKind !== 'aisle' && ' New seats made with this tool use the selected seat category.'}
            </p>
          </div>
          <SeatGrid gridRows={state.gridRows} gridCols={state.gridCols} cells={state.cells} categories={state.categories} readOnly={readOnly} onPaint={paint} />
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Seats">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
              {state.categories.map((c) => (
                <div key={c.code} className="contents">
                  <dt className="flex items-center gap-2 text-muted">
                    <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: c.color }} aria-hidden />
                    {c.name}
                  </dt>
                  <dd className="text-right tabular-nums text-fg">{counts.byCategory[c.code] ?? 0}</dd>
                </div>
              ))}
              <dt className="mt-1.5 border-t border-line pt-1.5 font-semibold text-fg">Total</dt>
              <dd className="mt-1.5 border-t border-line pt-1.5 text-right font-semibold tabular-nums text-fg">{counts.total}</dd>
              <dt className="text-subtle">Sellable</dt>
              <dd className="text-right tabular-nums text-muted">{counts.active}</dd>
              <dt className="text-subtle">Disabled</dt>
              <dd className="text-right tabular-nums text-muted">{counts.inactive}</dd>
              <dt className="text-subtle">Wheelchair spaces</dt>
              <dd className="text-right tabular-nums text-muted">{counts.byType.WHEELCHAIR}</dd>
              <dt className="text-subtle">Companion seats</dt>
              <dd className="text-right tabular-nums text-muted">{counts.byType.COMPANION}</dd>
              <dt className="text-subtle">Couple seats</dt>
              <dd className="text-right tabular-nums text-muted">{counts.byType.COUPLE}</dd>
            </dl>
          </Panel>
          <Panel title="Grid size">
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void applySize();
              }}
            >
              <Field label="Rows" className="flex-1">
                {({ id }) => <Input id={id} type="number" min={1} max={MAX_GRID_ROWS} value={rowsDraft} onChange={(e) => setRowsDraft(e.target.value)} disabled={readOnly} />}
              </Field>
              <Field label="Columns" className="flex-1">
                {({ id }) => <Input id={id} type="number" min={1} max={MAX_GRID_COLS} value={colsDraft} onChange={(e) => setColsDraft(e.target.value)} disabled={readOnly} />}
              </Field>
              <Button type="submit" variant="secondary" disabled={readOnly || (rowsDraft === String(state.gridRows) && colsDraft === String(state.gridCols))}>
                Apply
              </Button>
            </form>
            <p className="mt-2 text-xs text-subtle">Seats outside a smaller grid are removed. Empty rows become aisles and are skipped when lettering rows.</p>
          </Panel>
          <Panel title="Categories">
            <CategoryPanel
              categories={state.categories}
              counts={counts.byCategory}
              readOnly={readOnly}
              onAdd={onAddCategory}
              onUpdate={onUpdateCategory}
              onRemove={onRemoveCategory}
            />
          </Panel>
        </div>
      </div>

      {templateOpen && (
        <TemplateDialog
          categories={state.categories}
          initialRows={state.gridRows}
          initialCols={state.gridCols}
          onApply={(o) => void onTemplate(o)}
          onClose={() => setTemplateOpen(false)}
        />
      )}
    </div>
  );
}

export default function LayoutEditorPage() {
  const params = useParams();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const layout = useQuery({
    queryKey: adminKeys.layout(id),
    queryFn: () => adminApi.layout(id),
    enabled: validId,
    // The editor owns its draft; do not refetch underneath it.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const name = layout.data?.auditorium.name;
  useDocumentTitle(name ? `Seat layout · ${name}` : 'Seat layout');
  // The contract only guarantees auditorium { id, name }; use cinemaId when the backend includes it.
  const cinemaId = layout.data?.auditorium.cinemaId;
  const backTo = typeof cinemaId === 'number' ? `/admin/cinemas/${cinemaId}` : '/admin/cinemas';

  const back = (
    <Link to={backTo} className="inline-flex items-center gap-1 hover:text-fg">
      <ArrowLeft className="size-3" aria-hidden /> {typeof cinemaId === 'number' ? 'Cinema' : 'Cinemas'}
    </Link>
  );

  if (!validId) {
    return (
      <div>
        <AdminPageHeader eyebrow={back} title="Seat layout" />
        <EmptyState title="That is not a valid screen" action={<ButtonLink to="/admin/cinemas">All cinemas</ButtonLink>} />
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow={back}
        title={name ? `Seat layout: ${name}` : 'Seat layout'}
        description="Paint seats, aisles and accessible spaces. Rows are lettered from the screen and seats numbered left to right."
      />
      {layout.isPending ? (
        <LoadingRegion label="Loading seat layout" className="flex flex-col gap-4">
          <Skeleton className="h-14 rounded-lg" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <Skeleton className="h-[480px] rounded-lg" />
            <Skeleton className="h-[480px] rounded-lg" />
          </div>
        </LoadingRegion>
      ) : layout.isError ? (
        <ErrorState
          error={layout.error}
          title={isApiErrorCode(layout.error, 'NOT_FOUND') ? 'This screen no longer exists' : 'We could not load the seat layout'}
          onRetry={() => layout.refetch()}
          retrying={layout.isFetching}
        />
      ) : (
        <Editor key={id} auditoriumId={id} initial={layout.data} />
      )}
    </div>
  );
}
