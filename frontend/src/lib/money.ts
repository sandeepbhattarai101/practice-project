/**
 * Money helpers. All amounts from the API are integer minor units (paisa).
 * The currency symbol is set once from GET /api/config at boot.
 */

let currencySymbol = 'Rs.';

export function setCurrencySymbol(symbol: string): void {
  if (symbol) currencySymbol = symbol;
}

export function getCurrencySymbol(): string {
  return currencySymbol;
}

const wholeFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const fractionFormat = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `125000` → `Rs. 1,250`; `125050` → `Rs. 1,250.50`; `-5000` → `-Rs. 50`. */
export function formatMoney(minor: number, symbol: string = currencySymbol): string {
  if (!Number.isFinite(minor)) return `${symbol} —`;
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = abs % 100 === 0;
  const amount = whole ? wholeFormat.format(abs / 100) : fractionFormat.format(abs / 100);
  return `${negative ? '-' : ''}${symbol} ${amount}`;
}

/** Formats a min–max range, collapsing when equal. */
export function formatMoneyRange(minMinor: number, maxMinor: number): string {
  if (minMinor === maxMinor) return formatMoney(minMinor);
  return `${formatMoney(minMinor)} – ${formatMoney(maxMinor).replace(`${currencySymbol} `, '')}`;
}

/**
 * Parses a rupee amount typed by a person ("1,250.5") into paisa without floating-point drift.
 * Returns null for anything that is not a non-negative amount with at most 2 decimals.
 */
export function rupeesToPaisa(input: string | number): number | null {
  const text = String(input).trim().replace(/,/g, '');
  if (text === '') return null;
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(text);
  if (!match) return null;
  const rupees = Number(match[1]);
  const paisa = Number((match[2] ?? '').padEnd(2, '0'));
  const total = rupees * 100 + paisa;
  return Number.isSafeInteger(total) ? total : null;
}

/** `1250` → `"12.50"`; `120000` → `"1200"` (no trailing .00, for form fields). */
export function paisaToRupees(minor: number): string {
  const abs = Math.abs(minor);
  const sign = minor < 0 ? '-' : '';
  const rupees = Math.floor(abs / 100);
  const paisa = abs % 100;
  return paisa === 0 ? `${sign}${rupees}` : `${sign}${rupees}.${String(paisa).padStart(2, '0')}`;
}

/** Percent typed by a person ("12.5") → basis points (1250). Up to 2 decimals, 0–100. */
export function percentToBasisPoints(input: string | number): number | null {
  const text = String(input).trim();
  if (text === '') return null;
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(text);
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? '').padEnd(2, '0'));
  const bp = whole * 100 + frac;
  return bp <= 10000 ? bp : null;
}

/** 1250 → "12.5" */
export function basisPointsToPercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** 1300 basis points → "13%" */
export function formatBasisPoints(bp: number): string {
  return `${basisPointsToPercent(bp)}%`;
}

/**
 * Client-side ESTIMATE of the order total for the seat-selection summary.
 * The server's `pricing` is authoritative; never present this as the final amount.
 */
export function estimateTotal(subtotalMinor: number, serviceFeeMinor: number, taxRateBasisPoints: number, seatCount: number) {
  if (seatCount === 0) return { feeMinor: 0, taxMinor: 0, totalMinor: 0 };
  // The backend charges the service fee per ticket (PricingCalculator).
  const feeMinor = serviceFeeMinor * seatCount;
  const taxMinor = Math.round(((subtotalMinor + feeMinor) * taxRateBasisPoints) / 10000);
  return { feeMinor, taxMinor, totalMinor: subtotalMinor + feeMinor + taxMinor };
}
