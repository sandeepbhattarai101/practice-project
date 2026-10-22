import { num, str } from './shared';

/**
 * The contract does not define the admin payment row, so every field is read defensively.
 * `bookingReference` also falls back to `reference` or a nested `booking.reference`.
 */
export interface PaymentView {
  bookingReference: string | null;
  amountMinor: number | null;
  providerRef: string | null;
  failureReason: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

/** Keys rendered explicitly by the payment views; anything else is listed as "other fields". */
export const KNOWN_PAYMENT_KEYS = new Set([
  'id',
  'bookingReference',
  'reference',
  'booking',
  'provider',
  'status',
  'amountMinor',
  'providerRef',
  'failureReason',
  'createdAt',
  'completedAt',
  'events',
]);

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function paymentView(payment: unknown): PaymentView {
  const p = record(payment);
  return {
    bookingReference: str(p.bookingReference) ?? str(p.reference) ?? str(record(p.booking).reference),
    amountMinor: num(p.amountMinor),
    providerRef: str(p.providerRef),
    failureReason: str(p.failureReason),
    createdAt: str(p.createdAt),
    completedAt: str(p.completedAt),
  };
}

/** Scalar fields the server sent that the UI does not otherwise show. */
export function otherPaymentFields(payment: unknown): { key: string; value: string }[] {
  return Object.entries(record(payment))
    .filter(([k, v]) => !KNOWN_PAYMENT_KEYS.has(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .map(([k, v]) => ({ key: k, value: String(v) }));
}

const PROVIDER_LABELS: Record<string, string> = { ESEWA: 'eSewa', KHALTI: 'Khalti', DEV_SANDBOX: 'Development sandbox' };

export function providerLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return PROVIDER_LABELS[code] ?? code;
}
