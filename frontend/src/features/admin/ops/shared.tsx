import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * Copies server `fieldErrors` onto react-hook-form fields. `fieldMap` translates contract
 * field names (e.g. `maxDiscountMinor`) to form field names (e.g. `maxDiscount`).
 * Returns the number of errors that were attached to a field.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fieldNames: readonly Path<T>[],
  fieldMap: Partial<Record<string, Path<T>>> = {},
): number {
  if (!(error instanceof ApiError)) return 0;
  let applied = 0;
  for (const fe of error.fieldErrors) {
    const mapped = fieldMap[fe.field] ?? (fieldNames.includes(fe.field as Path<T>) ? (fe.field as Path<T>) : undefined);
    if (mapped) {
      setError(mapped, { type: 'server', message: fe.message });
      applied += 1;
    }
  }
  return applied;
}

/** Pretty-prints any JSON-ish value for display. */
export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value; // A plain string, not encoded JSON: show it as-is.
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Collapsible <details> block with pretty-printed JSON. */
export function JsonDetails({ value, summary = 'Details', className }: { value: unknown; summary?: string; className?: string }) {
  const text = prettyJson(value);
  if (!text || text === '{}' || text === '[]') return <span className="text-subtle">—</span>;
  return (
    <details className={cn('group max-w-full', className)}>
      <summary className="cursor-pointer select-none text-xs font-semibold text-muted transition-colors duration-150 hover:text-fg">
        {summary}
      </summary>
      <pre className="mt-2 max-h-72 max-w-[min(100%,560px)] overflow-auto rounded-md border border-line bg-canvas p-3 text-[12px] leading-relaxed text-muted">
        {text}
      </pre>
    </details>
  );
}

/** Small key/value line used in detail cards. */
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12.5px] tracking-tight text-fg', className)}>{children}</span>;
}

/** Reads an unknown value as a string, or null. */
export function str(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Reads an unknown value as a finite number, or null. */
export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
