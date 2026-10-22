import { describe, expect, it } from 'vitest';
import type { AdminCoupon } from '@/types/api';
import {
  couponSchema,
  couponToFormValues,
  emptyCouponForm,
  formatCouponDiscount,
  instantToLocalDateTime,
  localDateTimeToInstant,
  toCouponInput,
  type CouponFormValues,
} from './couponForm';

const form = (overrides: Partial<CouponFormValues> = {}): CouponFormValues => ({
  ...emptyCouponForm,
  code: 'dashain25',
  description: 'Festival offer',
  discountType: 'PERCENT',
  discountValue: '12.5',
  ...overrides,
});

describe('toCouponInput', () => {
  it('sends a PERCENT discount as basis points (12.5% → 1250)', () => {
    expect(toCouponInput(form()).discountValue).toBe(1250);
    expect(toCouponInput(form({ discountValue: '10' })).discountValue).toBe(1000);
  });

  it('sends a FIXED discount in paisa (Rs. 1,250.50 → 125050)', () => {
    const body = toCouponInput(form({ discountType: 'FIXED', discountValue: '1,250.50' }));
    expect(body.discountType).toBe('FIXED');
    expect(body.discountValue).toBe(125050);
  });

  it('converts rupee limits to paisa and blanks to null', () => {
    const body = toCouponInput(form({ maxDiscount: '300', minSubtotal: '1,000.5' }));
    expect(body.maxDiscountMinor).toBe(30000);
    expect(body.minSubtotalMinor).toBe(100050);

    const blank = toCouponInput(form());
    expect(blank).toMatchObject({
      maxDiscountMinor: null,
      minSubtotalMinor: null,
      validFrom: null,
      validUntil: null,
      usageLimit: null,
      perUserLimit: null,
      movieId: null,
      cinemaId: null,
    });
  });

  it('drops the cap for a FIXED discount', () => {
    expect(toCouponInput(form({ discountType: 'FIXED', discountValue: '50', maxDiscount: '100' })).maxDiscountMinor).toBeNull();
  });

  it('upper-cases the code and maps ids and limits to numbers', () => {
    const body = toCouponInput(form({ usageLimit: '500', perUserLimit: '2', movieId: '7', cinemaId: '3' }));
    expect(body.code).toBe('DASHAIN25');
    expect(body).toMatchObject({ usageLimit: 500, perUserLimit: 2, movieId: 7, cinemaId: 3, isActive: true });
  });

  it('converts validity in Kathmandu time to ISO instants', () => {
    const body = toCouponInput(form({ validFrom: '2026-10-22T18:30', validUntil: '2026-11-01T00:00' }));
    expect(body.validFrom).toBe('2026-10-22T12:45:00Z');
    expect(body.validUntil).toBe('2026-10-31T18:15:00Z');
  });
});

describe('couponToFormValues', () => {
  const coupon: AdminCoupon = {
    id: 1,
    usedCount: 12,
    code: 'DASHAIN25',
    description: 'Festival offer',
    discountType: 'PERCENT',
    discountValue: 1250,
    maxDiscountMinor: 125050,
    minSubtotalMinor: null,
    validFrom: '2026-10-22T12:45:00Z',
    validUntil: null,
    usageLimit: 500,
    perUserLimit: null,
    movieId: null,
    cinemaId: 3,
    isActive: false,
  };

  it('applies the inverse conversions', () => {
    expect(couponToFormValues(coupon)).toEqual({
      code: 'DASHAIN25',
      description: 'Festival offer',
      discountType: 'PERCENT',
      discountValue: '12.5',
      maxDiscount: '1250.50',
      minSubtotal: '',
      validFrom: '2026-10-22T18:30',
      validUntil: '',
      usageLimit: '500',
      perUserLimit: '',
      movieId: '',
      cinemaId: '3',
      isActive: false,
    });
  });

  it('round-trips through the form', () => {
    const { id: _id, usedCount: _used, ...input } = coupon;
    expect(toCouponInput(couponToFormValues(coupon))).toEqual(input);
  });

  it('shows a FIXED value in rupees', () => {
    expect(couponToFormValues({ ...coupon, discountType: 'FIXED', discountValue: 5000 }).discountValue).toBe('50');
  });
});

describe('date-time helpers', () => {
  it('handles blanks and bare dates', () => {
    expect(localDateTimeToInstant('')).toBeNull();
    expect(instantToLocalDateTime(null)).toBe('');
    expect(instantToLocalDateTime('2026-12-31')).toBe('2026-12-31T00:00');
  });
});

describe('couponSchema', () => {
  it('accepts a valid coupon', () => {
    expect(couponSchema.safeParse(form()).success).toBe(true);
  });

  it('rejects percentages over 100 and validity that ends before it starts', () => {
    const result = couponSchema.safeParse(form({ discountValue: '120', validFrom: '2026-11-01T00:00', validUntil: '2026-10-01T00:00' }));
    const paths = result.error?.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['discountValue', 'validUntil']));
  });

  it('rejects malformed rupee amounts and non-integer limits', () => {
    const result = couponSchema.safeParse(form({ minSubtotal: '12.345', usageLimit: '1.5' }));
    const paths = result.error?.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['minSubtotal', 'usageLimit']));
  });
});

describe('formatCouponDiscount', () => {
  it('formats both discount types', () => {
    expect(formatCouponDiscount('PERCENT', 1000)).toBe('10%');
    expect(formatCouponDiscount('PERCENT', 1250)).toBe('12.5%');
    expect(formatCouponDiscount('FIXED', 5000)).toBe('Rs. 50');
  });
});
