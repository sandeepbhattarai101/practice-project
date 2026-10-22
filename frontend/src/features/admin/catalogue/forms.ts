import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, errorMessage } from '@/lib/api';

/**
 * Maps a server VALIDATION_FAILED response onto react-hook-form fields.
 * Field names such as `cast[0].name` are normalised to `cast.0.name`. Returns the message to show
 * as the form-level error (the server's message, plus any field errors that have no matching input).
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  const unmatched: string[] = [];
  for (const fe of error.fieldErrors) {
    const name = fe.field.replace(/\[(\d+)\]/g, '.$1');
    const root = name.split('.')[0];
    if (knownFields.includes(root)) setError(name as Path<T>, { type: 'server', message: fe.message });
    else unmatched.push(`${fe.field}: ${fe.message}`);
  }
  return unmatched.length > 0 ? `${error.message} (${unmatched.join('; ')})` : error.message;
}

/** Empty string → null, otherwise a finite number (NaN stays NaN so validation can flag it). */
export function optionalNumber(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return Number(t);
}
