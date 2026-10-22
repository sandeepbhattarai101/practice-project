import { getStored, setStored, STORAGE_KEYS } from './storage';

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 v4 fallback for browsers without randomUUID (non-secure contexts).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const keyFor = (reference: string, provider: string) => `${STORAGE_KEYS.idempotency(reference)}.${provider}`;
const paymentIdFor = (reference: string, provider: string) => `${keyFor(reference, provider)}.paymentId`;

/**
 * The Idempotency-Key for the current payment attempt on a booking + provider. Kept in
 * sessionStorage so double clicks, retries after network errors and page reloads reuse it.
 */
export function getPaymentAttemptKey(reference: string, provider: string): string {
  const existing = getStored(keyFor(reference, provider), 'session');
  if (existing) return existing;
  const fresh = uuid();
  setStored(keyFor(reference, provider), fresh, 'session');
  return fresh;
}

/** Records which payment the current key created, so a failed payment can start a new attempt. */
export function rememberPaymentAttempt(reference: string, provider: string, paymentId: number): void {
  setStored(paymentIdFor(reference, provider), String(paymentId), 'session');
}

export function resetPaymentAttempt(reference: string, provider: string): void {
  setStored(keyFor(reference, provider), null, 'session');
  setStored(paymentIdFor(reference, provider), null, 'session');
}

const FINISHED_UNSUCCESSFULLY = new Set(['FAILED', 'CANCELLED', 'EXPIRED']);

/**
 * If the payment created by a stored key has since failed/been cancelled/expired, discard that
 * key: reusing it would only replay the failed attempt.
 */
export function resetFailedAttempts(
  reference: string,
  payments: { id: number; provider: string; status: string }[],
): void {
  for (const p of payments) {
    if (!FINISHED_UNSUCCESSFULLY.has(p.status)) continue;
    if (getStored(paymentIdFor(reference, p.provider), 'session') === String(p.id)) resetPaymentAttempt(reference, p.provider);
  }
}
