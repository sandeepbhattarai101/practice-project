package com.practiceproject.booking;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Pure pricing maths, no database: easy to unit test (see PricingCalculatorTest).
 *
 * Ticket prices are entered tax-exclusive. Order of operations:
 *   subtotal  = sum of seat prices
 *   discount  = min(coupon discount, subtotal)
 *   fees      = per-ticket fee x tickets
 *   tax       = round_half_up((subtotal - discount + fees) x rate)
 *   total     = subtotal - discount + fees + tax
 */
public final class PricingCalculator {

    public record Breakdown(long subtotalMinor, long discountMinor, long feeMinor, long taxMinor, long totalMinor) {}

    private PricingCalculator() {}

    public static Breakdown calculate(long subtotalMinor, long requestedDiscountMinor, int tickets,
                                      long feePerTicketMinor, int taxRateBasisPoints) {
        if (subtotalMinor < 0 || requestedDiscountMinor < 0 || tickets < 0 || feePerTicketMinor < 0 || taxRateBasisPoints < 0) {
            throw new IllegalArgumentException("Pricing inputs must not be negative");
        }
        long discount = Math.min(requestedDiscountMinor, subtotalMinor);
        long fees = Math.multiplyExact(feePerTicketMinor, tickets);
        long taxable = subtotalMinor - discount + fees;
        long tax = BigDecimal.valueOf(taxable)
                .multiply(BigDecimal.valueOf(taxRateBasisPoints))
                .divide(BigDecimal.valueOf(10_000), 0, RoundingMode.HALF_UP)
                .longValueExact();
        return new Breakdown(subtotalMinor, discount, fees, tax, taxable + tax);
    }

    /** Percentage refund, rounded down so we never refund more than the policy says. */
    public static long refund(long totalMinor, int percent) {
        if (percent <= 0) {
            return 0;
        }
        if (percent >= 100) {
            return totalMinor;
        }
        return BigDecimal.valueOf(totalMinor).multiply(BigDecimal.valueOf(percent))
                .divide(BigDecimal.valueOf(100), 0, RoundingMode.DOWN).longValueExact();
    }
}
