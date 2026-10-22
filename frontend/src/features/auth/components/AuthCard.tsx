import type { ReactNode } from 'react';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { isApiError } from '@/lib/api';

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main id="main" className="relative grid min-h-[calc(100vh-4rem)] place-items-center overflow-hidden px-4 py-14">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgb(245_181_68/0.08),transparent_60%)]" aria-hidden />
      <div className="relative w-full max-w-md">
        <h1 className="text-center font-display text-4xl text-fg">{title}</h1>
        {subtitle && <p className="mt-2 text-center text-muted">{subtitle}</p>}
        <div className="mt-8 rounded-lg border border-line bg-surface p-6 shadow-card sm:p-8">{children}</div>
        {footer && <div className="mt-6 text-center text-sm text-subtle">{footer}</div>}
      </div>
    </main>
  );
}

/**
 * Copies server `fieldErrors` onto matching form fields. Returns true when at least one field
 * received a message (so the caller can avoid repeating it as a form-level error).
 */
export function applyServerFieldErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fields: readonly Path<T>[]): boolean {
  if (!isApiError(error)) return false;
  let applied = false;
  for (const f of error.fieldErrors) {
    const match = fields.find((name) => name === f.field);
    if (match) {
      setError(match, { type: 'server', message: f.message });
      applied = true;
    }
  }
  return applied;
}
