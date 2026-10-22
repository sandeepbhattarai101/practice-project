import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useDebouncedValue } from '@/lib/hooks';

/**
 * Filter state kept in the URL search params so lists are shareable and survive reloads.
 * A value equal to its default is removed from the URL. Changing any filter other than
 * `page` resets paging to the first page.
 */
export function useUrlFilters<K extends string>(defaults: Record<K, string>) {
  const [params, setParams] = useSearchParams();
  const keys = useMemo(() => Object.keys(defaults) as K[], [defaults]);

  const values = useMemo(() => {
    const out = {} as Record<K, string>;
    for (const k of keys) out[k] = params.get(k) ?? defaults[k];
    return out;
  }, [params, keys, defaults]);

  const page = Math.max(0, Number.parseInt(params.get('page') ?? '0', 10) || 0);

  const setFilters = useCallback(
    (patch: Partial<Record<K, string>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
            if (v === undefined || v === defaults[k]) next.delete(k);
            else next.set(k, v);
          }
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams, defaults],
  );

  const setPage = useCallback(
    (p: number) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (p <= 0) next.delete('page');
          else next.set('page', String(p));
          return next;
        },
        { replace: false },
      );
    },
    [setParams],
  );

  return { values, setFilters, page, setPage };
}

/**
 * A text input whose value is debounced into a URL filter. Returns the immediate
 * value for the input and its setter.
 */
export function useDebouncedFilter(urlValue: string, commit: (value: string) => void, delayMs = 300) {
  const [draft, setDraft] = useState(urlValue);
  const debounced = useDebouncedValue(draft, delayMs);

  useEffect(() => {
    if (debounced !== urlValue) commit(debounced);
    // Only react to the debounced draft; urlValue changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  useEffect(() => {
    // External navigation (back/forward) changed the URL: reflect it in the input.
    setDraft((current) => (current === debounced && current !== urlValue ? urlValue : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlValue]);

  return [draft, setDraft] as const;
}

/** Parses a numeric id filter from the URL; '' when absent or invalid. */
export function idParam(value: string): number | '' {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : '';
}
