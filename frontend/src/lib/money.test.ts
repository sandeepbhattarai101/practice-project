import { describe, expect, it } from 'vitest';
import {
  basisPointsToPercent,
  estimateTotal,
  formatBasisPoints,
  formatMoney,
  formatMoneyRange,
  paisaToRupees,
  percentToBasisPoints,
  rupeesToPaisa,
  setCurrencySymbol,
} from './money';

describe('formatMoney', () => {
  it('drops .00 for whole rupee amounts', () => {
    expect(formatMoney(125000)).toBe('Rs. 1,250');
    expect(formatMoney(0)).toBe('Rs. 0');
    expect(formatMoney(150000)).toBe('Rs. 1,500');
  });

  it('shows two decimals otherwise', () => {
    expect(formatMoney(125050)).toBe('Rs. 1,250.50');
    expect(formatMoney(1)).toBe('Rs. 0.01');
    expect(formatMoney(99)).toBe('Rs. 0.99');
  });

  it('groups thousands and handles negatives', () => {
    expect(formatMoney(123456789)).toBe('Rs. 1,234,567.89');
    expect(formatMoney(-5000)).toBe('-Rs. 50');
  });

  it('uses the configured currency symbol', () => {
    setCurrencySymbol('NPR');
    expect(formatMoney(45000)).toBe('NPR 450');
    setCurrencySymbol('Rs.');
    expect(formatMoney(45000)).toBe('Rs. 450');
  });

  it('collapses equal ranges', () => {
    expect(formatMoneyRange(40000, 40000)).toBe('Rs. 400');
    expect(formatMoneyRange(40000, 75000)).toBe('Rs. 400 – 750');
  });
});

describe('rupee ↔ paisa conversion (coupon FIXED values)', () => {
  it('parses typed rupees into integer paisa without float drift', () => {
    expect(rupeesToPaisa('1250')).toBe(125000);
    expect(rupeesToPaisa('1,250.5')).toBe(125050);
    expect(rupeesToPaisa('1.005'.slice(0, 4))).toBe(100); // "1.00"
    expect(rupeesToPaisa('0.29')).toBe(29); // 0.29 * 100 = 28.999… in floating point
    expect(rupeesToPaisa(19.99)).toBe(1999);
    expect(rupeesToPaisa(' 50 ')).toBe(5000);
  });

  it('rejects invalid input', () => {
    expect(rupeesToPaisa('')).toBeNull();
    expect(rupeesToPaisa('-5')).toBeNull();
    expect(rupeesToPaisa('1.234')).toBeNull();
    expect(rupeesToPaisa('abc')).toBeNull();
  });

  it('formats paisa back for form fields', () => {
    expect(paisaToRupees(125000)).toBe('1250');
    expect(paisaToRupees(125050)).toBe('1250.50');
    expect(paisaToRupees(5)).toBe('0.05');
  });

  it('round-trips', () => {
    for (const minor of [0, 1, 99, 100, 12345, 125050, 9999999]) {
      expect(rupeesToPaisa(paisaToRupees(minor))).toBe(minor);
    }
  });
});

describe('percent ↔ basis points conversion (coupon PERCENT values)', () => {
  it('converts percentages to basis points', () => {
    expect(percentToBasisPoints('10')).toBe(1000);
    expect(percentToBasisPoints('12.5')).toBe(1250);
    expect(percentToBasisPoints('0.01')).toBe(1);
    expect(percentToBasisPoints('100')).toBe(10000);
    expect(percentToBasisPoints(7.25)).toBe(725);
  });

  it('rejects out-of-range or malformed values', () => {
    expect(percentToBasisPoints('100.01')).toBeNull();
    expect(percentToBasisPoints('-1')).toBeNull();
    expect(percentToBasisPoints('12.345')).toBeNull();
    expect(percentToBasisPoints('')).toBeNull();
  });

  it('converts basis points back to a display percentage', () => {
    expect(basisPointsToPercent(1000)).toBe('10');
    expect(basisPointsToPercent(1250)).toBe('12.5');
    expect(basisPointsToPercent(725)).toBe('7.25');
    expect(basisPointsToPercent(1)).toBe('0.01');
    expect(formatBasisPoints(1300)).toBe('13%');
  });

  it('round-trips', () => {
    for (const bp of [0, 1, 50, 725, 1000, 1250, 9999, 10000]) {
      expect(percentToBasisPoints(basisPointsToPercent(bp))).toBe(bp);
    }
  });
});

describe('estimateTotal', () => {
  it('is zero with no seats', () => {
    expect(estimateTotal(0, 5000, 1300, 0)).toEqual({ feeMinor: 0, taxMinor: 0, totalMinor: 0 });
  });

  it('charges the service fee per ticket and tax on subtotal + fees', () => {
    // Rs. 900 for 2 seats + 2 x Rs. 25 fee = Rs. 950; 13% = Rs. 123.50 (matches backend PricingCalculator)
    expect(estimateTotal(90000, 2500, 1300, 2)).toEqual({ feeMinor: 5000, taxMinor: 12350, totalMinor: 107350 });
  });
});
