/**
 * localStorage / sessionStorage wrappers for conveniences only (selected city, dismissed banners,
 * idempotency keys). Storage can be unavailable (private mode, blocked site data), so every access
 * degrades to "nothing stored" rather than throwing.
 */
function safe(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getStored(key: string, kind: 'local' | 'session' = 'local'): string | null {
  try {
    return safe(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function setStored(key: string, value: string | null, kind: 'local' | 'session' = 'local'): void {
  try {
    const s = safe(kind);
    if (!s) return;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    // Storage full or blocked: the convenience is simply not remembered.
  }
}

export const STORAGE_KEYS = {
  city: 'pp.city',
  dismissedBanners: 'pp.dismissedBanners',
  idempotency: (reference: string) => `pp.idem.${reference}`,
} as const;
