import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save } from 'lucide-react';
import { Button, EmptyState, ErrorState, FormError, Input, LoadingRegion, Skeleton, toast } from '@/components/ui';
import { adminApi, adminKeys } from '@/features/admin/api';
import { AdminPageHeader } from '@/features/admin/components/AdminUi';
import { configKeys } from '@/features/config/api';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { DEFAULT_TIMEZONE, formatDateTime } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import type { AdminSetting } from '@/types/api';

type SettingValue = AdminSetting['value'];
/** Drafts are kept as typed: strings for text and number inputs, booleans for checkboxes. */
type Draft = string | boolean;

function initialDraft(value: SettingValue): Draft {
  if (typeof value === 'boolean') return value;
  if (value === null) return '';
  return String(value);
}

/** Converts a draft back to the setting's original type. Returns undefined for an invalid number. */
function parseDraft(setting: AdminSetting, draft: Draft): SettingValue | undefined {
  if (typeof setting.value === 'boolean') return Boolean(draft);
  if (typeof setting.value === 'number') {
    const text = String(draft).trim();
    if (text === '' || !Number.isFinite(Number(text))) return undefined;
    return Number(text);
  }
  return String(draft);
}

function isDirty(setting: AdminSetting, draft: Draft | undefined): boolean {
  return draft !== undefined && draft !== initialDraft(setting.value);
}

export default function SettingsPage() {
  useDocumentTitle('Settings');
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: adminKeys.settings(), queryFn: adminApi.settings });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const settings = query.data ?? [];
  const dirty = settings.filter((s) => isDirty(s, drafts[s.key]));
  const invalid = dirty.filter((s) => parseDraft(s, drafts[s.key]) === undefined);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, SettingValue> = {};
      for (const s of dirty) {
        const v = parseDraft(s, drafts[s.key]);
        if (v !== undefined) body[s.key] = v;
      }
      return adminApi.saveSettings(body);
    },
    onSuccess: async (updated) => {
      if (Array.isArray(updated)) queryClient.setQueryData(adminKeys.settings(), updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.settings() }),
        // Several settings feed the public config (fees, tax, hold time).
        queryClient.invalidateQueries({ queryKey: configKeys.all }),
      ]);
      setDrafts({});
      toast.success(`${dirty.length} ${dirty.length === 1 ? 'setting' : 'settings'} saved`);
    },
  });

  const fieldError = (key: string) => (save.error instanceof ApiError ? save.error.fieldError(key) : undefined);

  const actions = (
    <>
      <Button variant="ghost" onClick={() => setDrafts({})} disabled={dirty.length === 0 || save.isPending} leftIcon={<RotateCcw className="size-4" aria-hidden />}>
        Discard
      </Button>
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={dirty.length === 0 || invalid.length > 0} leftIcon={<Save className="size-4" aria-hidden />}>
        {dirty.length > 0 ? `Save ${dirty.length} ${dirty.length === 1 ? 'change' : 'changes'}` : 'Save'}
      </Button>
    </>
  );

  return (
    <>
      <AdminPageHeader title="Settings" description="Platform-wide values. Changes apply immediately after saving." actions={actions} />
      <FormError message={save.error ? errorMessage(save.error) : null} />
      {query.isPending ? (
        <LoadingRegion label="Loading settings" className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-72" />
              </div>
              <Skeleton className="h-10" />
            </div>
          ))}
        </LoadingRegion>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />
      ) : settings.length === 0 ? (
        <EmptyState title="No settings" description="The server did not return any editable settings." />
      ) : (
        <ul className={cn('flex flex-col divide-y divide-line rounded-lg border border-line bg-surface', save.error && 'mt-4')}>
          {settings.map((s) => {
            const draft = drafts[s.key] ?? initialDraft(s.value);
            const changed = isDirty(s, drafts[s.key]);
            const bad = changed && parseDraft(s, draft) === undefined;
            const error = bad ? 'Enter a number' : fieldError(s.key);
            const inputId = `setting-${s.key}`;
            const descId = `${inputId}-desc`;
            const set = (v: Draft) => setDrafts((d) => ({ ...d, [s.key]: v }));
            return (
              <li key={s.key} className={cn('grid gap-3 p-4 transition-colors duration-200 sm:grid-cols-[minmax(0,1fr)_280px] sm:items-center', changed && 'bg-accent-soft/40')}>
                <div className="min-w-0">
                  <label htmlFor={inputId} className="flex items-center gap-2 font-mono text-[13px] font-semibold text-fg">
                    {s.key}
                    {changed && <span className="rounded-xs bg-accent-soft px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-accent">Edited</span>}
                  </label>
                  <p id={descId} className="mt-0.5 text-sm text-muted">
                    {s.description ?? 'No description.'}
                    <span className="ml-1 text-xs text-subtle">Updated {formatDateTime(s.updatedAt, DEFAULT_TIMEZONE)}</span>
                  </p>
                </div>
                <div>
                  {typeof s.value === 'boolean' ? (
                    <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-muted">
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={Boolean(draft)}
                        onChange={(e) => set(e.target.checked)}
                        aria-describedby={descId}
                        className="size-4 cursor-pointer accent-[var(--color-accent)]"
                      />
                      {draft ? 'On' : 'Off'}
                    </label>
                  ) : (
                    <Input
                      id={inputId}
                      type={typeof s.value === 'number' ? 'number' : 'text'}
                      inputMode={typeof s.value === 'number' ? 'decimal' : undefined}
                      step="any"
                      value={String(draft)}
                      onChange={(e) => set(e.target.value)}
                      aria-describedby={error ? `${descId} ${inputId}-err` : descId}
                      aria-invalid={Boolean(error)}
                      className={typeof s.value === 'number' ? 'tabular-nums' : undefined}
                    />
                  )}
                  {error && (
                    <p id={`${inputId}-err`} className="mt-1 text-xs font-medium text-danger">
                      {error}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
