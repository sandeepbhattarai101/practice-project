import { z } from 'zod';
import { calendarDateInZone, DEFAULT_TIMEZONE, localToInstant, wallTimeInZone } from '@/lib/dates';
import { basisPointsToPercent, formatBasisPoints, formatMoney, paisaToRupees, percentToBasisPoints, rupeesToPaisa } from '@/lib/money';
import type { AdminCoupon, CouponInput, DiscountType } from '@/types/api';

/**
 * Coupon form state. Amounts are typed in rupees, percentages as percent (12.5), and
 * validity as `datetime-local` values ("YYYY-MM-DDTHH:mm") interpreted in `DEFAULT_TIMEZONE`.
 */
export interface CouponFormValues {
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: string;
  maxDiscount: string;
  minSubtotal: string;
  validFrom: string;
  validUntil: string;
  usageLimit: string;
  perUserLimit: string;
  movieId: string;
  cinemaId: string;
  isActive: boolean;
}

export const emptyCouponForm: CouponFormValues = {
  code: '',
  description: '',
  discountType: 'PERCENT',
  discountValue: '',
  maxDiscount: '',
  minSubtotal: '',
  validFrom: '',
  validUntil: '',
  usageLimit: '',
  perUserLimit: '',
  movieId: '',
  cinemaId: '',
  isActive: true,
};

/** Contract field → form field, for mapping server `fieldErrors`. */
export const couponFieldMap: Record<string, keyof CouponFormValues> = {
  maxDiscountMinor: 'maxDiscount',
  minSubtotalMinor: 'minSubtotal',
};

const LOCAL_DT_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

const rupeesOrBlank = z
  .string()
  .trim()
  .refine((v) => v === '' || rupeesToPaisa(v) !== null, 'Enter an amount in rupees, e.g. 500 or 499.50');

const intOrBlank = z
  .string()
  .trim()
  .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number.isSafeInteger(Number(v))), 'Enter a whole number of 1 or more, or leave blank');

export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, 'Use at least 3 characters')
      .max(40, 'Use no more than 40 characters')
      .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, hyphens and underscores only'),
    description: z.string().trim().max(200, 'Use no more than 200 characters'),
    discountType: z.enum(['PERCENT', 'FIXED']),
    discountValue: z.string().trim().min(1, 'Enter the discount'),
    maxDiscount: rupeesOrBlank,
    minSubtotal: rupeesOrBlank,
    validFrom: z.string().refine((v) => v === '' || LOCAL_DT_RE.test(v), 'Enter a date and time'),
    validUntil: z.string().refine((v) => v === '' || LOCAL_DT_RE.test(v), 'Enter a date and time'),
    usageLimit: intOrBlank,
    perUserLimit: intOrBlank,
    movieId: z.string(),
    cinemaId: z.string(),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.discountValue !== '') {
      if (v.discountType === 'PERCENT') {
        const bp = percentToBasisPoints(v.discountValue);
        if (bp === null || bp <= 0) {
          ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Enter a percentage above 0 and up to 100, with at most 2 decimals' });
        }
      } else {
        const p = rupeesToPaisa(v.discountValue);
        if (p === null || p <= 0) {
          ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Enter an amount in rupees above 0' });
        }
      }
    }
    if (v.validFrom && v.validUntil && v.validFrom >= v.validUntil) {
      ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'The end must be after the start' });
    }
  });

function blankToNull<T>(value: string, map: (v: string) => T | null): T | null {
  const v = value.trim();
  return v === '' ? null : map(v);
}

/** "2026-10-22T18:30" (wall clock in `timeZone`) → ISO instant; blank → null. */
export function localDateTimeToInstant(value: string, timeZone: string = DEFAULT_TIMEZONE): string | null {
  const m = LOCAL_DT_RE.exec(value.trim());
  if (!m) return null;
  return localToInstant(m[1], m[2], timeZone);
}

/** ISO instant → "2026-10-22T18:30" for a datetime-local input. A bare date becomes midnight. */
export function instantToLocalDateTime(value: string | null | undefined, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${calendarDateInZone(date, timeZone)}T${wallTimeInZone(date, timeZone)}`;
}

/** Form → request body. Assumes the values passed `couponSchema`. */
export function toCouponInput(values: CouponFormValues, timeZone: string = DEFAULT_TIMEZONE): CouponInput {
  const discountValue =
    values.discountType === 'PERCENT' ? percentToBasisPoints(values.discountValue.trim()) : rupeesToPaisa(values.discountValue);
  if (discountValue === null) throw new Error(`Invalid discount: ${values.discountValue}`);
  return {
    code: values.code.trim().toUpperCase(),
    description: values.description.trim(),
    discountType: values.discountType,
    discountValue,
    // A cap only makes sense for percentages; a fixed discount is its own cap.
    maxDiscountMinor: values.discountType === 'PERCENT' ? blankToNull(values.maxDiscount, rupeesToPaisa) : null,
    minSubtotalMinor: blankToNull(values.minSubtotal, rupeesToPaisa),
    validFrom: localDateTimeToInstant(values.validFrom, timeZone),
    validUntil: localDateTimeToInstant(values.validUntil, timeZone),
    usageLimit: blankToNull(values.usageLimit, Number),
    perUserLimit: blankToNull(values.perUserLimit, Number),
    movieId: blankToNull(values.movieId, Number),
    cinemaId: blankToNull(values.cinemaId, Number),
    isActive: values.isActive,
  };
}

const optionalRupees = (minor: number | null | undefined) => (minor === null || minor === undefined ? '' : paisaToRupees(minor));
const optionalInt = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** Coupon → form values (inverse conversions) for editing. */
export function couponToFormValues(coupon: AdminCoupon, timeZone: string = DEFAULT_TIMEZONE): CouponFormValues {
  return {
    code: coupon.code,
    description: coupon.description ?? '',
    discountType: coupon.discountType,
    discountValue: coupon.discountType === 'PERCENT' ? basisPointsToPercent(coupon.discountValue) : paisaToRupees(coupon.discountValue),
    maxDiscount: optionalRupees(coupon.maxDiscountMinor),
    minSubtotal: optionalRupees(coupon.minSubtotalMinor),
    validFrom: instantToLocalDateTime(coupon.validFrom, timeZone),
    validUntil: instantToLocalDateTime(coupon.validUntil, timeZone),
    usageLimit: optionalInt(coupon.usageLimit),
    perUserLimit: optionalInt(coupon.perUserLimit),
    movieId: optionalInt(coupon.movieId),
    cinemaId: optionalInt(coupon.cinemaId),
    isActive: coupon.isActive,
  };
}

/** "10%" for PERCENT (basis points), "Rs. 50" for FIXED (paisa). */
export function formatCouponDiscount(type: DiscountType, value: number): string {
  return type === 'PERCENT' ? formatBasisPoints(value) : formatMoney(value);
}
